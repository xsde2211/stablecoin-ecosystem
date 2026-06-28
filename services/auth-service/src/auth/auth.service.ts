import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService }    from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import { RegisterDto }   from './dto/register.dto';
import { LoginDto }      from './dto/login.dto';
import * as bcrypt       from 'bcryptjs';
import * as speakeasy    from 'speakeasy';
import * as crypto       from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma:  PrismaService,
    private redis:   RedisService,
    private jwt:     JwtService,
  ) {}

  // ─── Register ───────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email:        dto.email,
        phone:        dto.phone,
        passwordHash,
      },
      select: {
        id:        true,
        email:     true,
        role:      true,
        kycStatus: true,
        createdAt: true,
      },
    });

    this.logger.log(`New user registered: ${user.id}`);
    return this.issueTokens(user.id, user.email, user.role);
  }

  // ─── Login ──────────────────────────────────────────────────────

  async login(dto: LoginDto, ip: string) {
    const failKey = `login:fail:${ip}`;
    const fails   = await this.redis.incr(failKey);
    if (fails === 1) await this.redis.expire(failKey, 900);
    if (fails > 5)  throw new UnauthorizedException('Too many attempts. Try again in 15 minutes.');

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user)          throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('Account suspended');

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('Invalid credentials');

    if (user.twoFaEnabled) {
      if (!dto.totpCode) {
        throw new UnauthorizedException('2FA code required');
      }
      const valid = speakeasy.totp.verify({
        secret:   user.twoFaSecret!,
        encoding: 'base32',
        token:    dto.totpCode,
        window:   1,
      });
      if (!valid) throw new UnauthorizedException('Invalid 2FA code');
    }

    await this.redis.del(failKey);
    this.logger.log(`User logged in: ${user.id}`);
    return this.issueTokens(user.id, user.email, user.role);
  }

  // ─── Refresh ────────────────────────────────────────────────────

  async refresh(token: string) {
    const stored = await this.redis.get(`refresh:${token}`);
    if (!stored) throw new UnauthorizedException('Refresh token expired or invalid');

    const { userId } = JSON.parse(stored);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or suspended');
    }

    await this.redis.del(`refresh:${token}`);
    return this.issueTokens(user.id, user.email, user.role);
  }

  // ─── Logout ─────────────────────────────────────────────────────

  async logout(userId: string, refreshToken: string) {
    await this.redis.del(`refresh:${refreshToken}`);
    this.logger.log(`User logged out: ${userId}`);
    return { message: 'Logged out successfully' };
  }

  // ─── Get Me (full DB lookup — never returns cached/JWT-only data) ─

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: {
        id:           true,
        email:        true,
        phone:        true,
        role:         true,
        kycStatus:    true,
        riskScore:    true,
        twoFaEnabled: true,
        isActive:     true,
        createdAt:    true,
        updatedAt:    true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ─── 2FA Setup ──────────────────────────────────────────────────

  async setup2FA(userId: string) {
    const secret = speakeasy.generateSecret({
      name:   'Stablecoin Ecosystem',
      length: 32,
    });

    await this.redis.set(
      `2fa:pending:${userId}`,
      secret.base32,
      300,
    );

    return {
      secret:     secret.base32,
      qrUri:      secret.otpauth_url,
      otpauthUrl: secret.otpauth_url,
    };
  }

  async verify2FA(userId: string, token: string) {
    const secret = await this.redis.get(`2fa:pending:${userId}`);
    if (!secret) throw new BadRequestException('2FA setup expired. Start setup again.');

    const valid = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window:   1,
    });
    if (!valid) throw new BadRequestException('Invalid 2FA code');

    await this.prisma.user.update({
      where: { id: userId },
      data:  { twoFaEnabled: true, twoFaSecret: secret },
    });

    await this.redis.del(`2fa:pending:${userId}`);
    return { message: '2FA enabled successfully' };
  }

  async disable2FA(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.twoFaEnabled) throw new BadRequestException('2FA is not enabled');

    const valid = speakeasy.totp.verify({
      secret:   user.twoFaSecret!,
      encoding: 'base32',
      token,
      window:   1,
    });
    if (!valid) throw new UnauthorizedException('Invalid 2FA code');

    await this.prisma.user.update({
      where: { id: userId },
      data:  { twoFaEnabled: false, twoFaSecret: null },
    });

    return { message: '2FA disabled successfully' };
  }

  // ─── Change password ─────────────────────────────────────────────

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where:{ id:userId }, data:{ passwordHash } });

    this.logger.log(`Password changed for user: ${userId}`);
    return { message: 'Password changed successfully' };
  }

  // ─── Token issuing ───────────────────────────────────────────────

  private async issueTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const accessToken = this.jwt.sign(payload, {
      secret:    process.env.JWT_SECRET,
      expiresIn: '15m',
    });

    const refreshToken = crypto.randomUUID();
    await this.redis.set(
      `refresh:${refreshToken}`,
      JSON.stringify({ userId }),
      60 * 60 * 24 * 7, // 7 days
    );

    return { accessToken, refreshToken };
  }
}
