import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
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
    // Check email not already used
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    // Hash password — 12 rounds is good balance of security vs speed
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

    // Return tokens immediately so user is logged in after register
    return this.issueTokens(user.id, user.email, user.role);
  }

  // ─── Login ──────────────────────────────────────────────────────

  async login(dto: LoginDto, ip: string) {
    // Rate limit: max 5 failed attempts per IP per 15 min
    const failKey = `login:fail:${ip}`;
    const fails   = await this.redis.incr(failKey);
    if (fails === 1) await this.redis.expire(failKey, 900);
    if (fails > 5)  throw new UnauthorizedException('Too many attempts. Try again in 15 minutes.');

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('Account suspended');

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('Invalid credentials');

    // 2FA check
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

    // Clear fail counter on success
    await this.redis.del(failKey);

    this.logger.log(`User logged in: ${user.id}`);
    return this.issueTokens(user.id, user.email, user.role);
  }

  // ─── Refresh ────────────────────────────────────────────────────

  async refresh(token: string) {
    const stored = await this.redis.get(`refresh:${token}`);
    if (!stored) throw new UnauthorizedException('Refresh token expired or invalid');

    const { userId } = JSON.parse(stored);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or suspended');
    }

    // Refresh token rotation — delete old, issue new
    await this.redis.del(`refresh:${token}`);

    return this.issueTokens(user.id, user.email, user.role);
  }

  // ─── Logout ─────────────────────────────────────────────────────

  async logout(userId: string, refreshToken: string) {
    await this.redis.del(`refresh:${refreshToken}`);
    this.logger.log(`User logged out: ${userId}`);
    return { message: 'Logged out successfully' };
  }

  // ─── 2FA Setup ──────────────────────────────────────────────────

  async setup2FA(userId: string) {
    const secret = speakeasy.generateSecret({
      name:   'Stablecoin Ecosystem',
      length: 32,
    });

    // Store secret temporarily until user verifies
    await this.redis.set(
      `2fa:pending:${userId}`,
      secret.base32,
      300, // 5 minutes to verify
    );

    return {
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
    };
  }

  async verify2FA(userId: string, token: string) {
    const secret = await this.redis.get(`2fa:pending:${userId}`);
    if (!secret) throw new BadRequestException('2FA setup expired. Start again.');

    const valid = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!valid) throw new BadRequestException('Invalid code');

    // Save secret permanently
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaEnabled: true, twoFaSecret: secret },
    });

    await this.redis.del(`2fa:pending:${userId}`);
    return { message: '2FA enabled successfully' };
  }

  // ─── Token issuing ───────────────────────────────────────────────

  private async issueTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    // Short-lived access token
    const accessToken = this.jwt.sign(payload, {
      secret:    process.env.JWT_SECRET,
      expiresIn: '15m',
    });

    // Long-lived refresh token — random UUID stored in Redis
    const refreshToken = crypto.randomUUID();
    await this.redis.set(
      `refresh:${refreshToken}`,
      JSON.stringify({ userId }),
      60 * 60 * 24 * 7, // 7 days
    );

    return { accessToken, refreshToken };
  }
}