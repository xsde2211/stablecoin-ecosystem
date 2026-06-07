import {
  Injectable, UnauthorizedException, ConflictException,
  BadRequestException, NotFoundException, Logger,
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
    private prisma: PrismaService,
    private redis:  RedisService,
    private jwt:    JwtService,
  ) {}

  // ─── Register ──────────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data:   { email: dto.email, phone: dto.phone, passwordHash },
      select: { id:true, email:true, role:true, kycStatus:true, createdAt:true },
    });

    this.logger.log(`New user registered: ${user.id}`);

    // Create audit log
    await this.prisma.auditLog.create({
      data: { userId: user.id, action: 'REGISTER', entityType: 'User', entityId: user.id },
    });

    return this.issueTokens(user.id, user.email, user.role);
  }

  // ─── Login ─────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, ip: string) {
    // Rate limit: 5 failed attempts per IP per 15 min
    const failKey = `login:fail:${ip}`;
    const fails   = await this.redis.incr(failKey);
    if (fails === 1) await this.redis.expire(failKey, 900);
    if (fails > 5)   throw new UnauthorizedException('Too many attempts. Try again in 15 minutes.');

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user)            throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive)   throw new UnauthorizedException('Account suspended');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // 2FA check
    if (user.twoFaEnabled) {
      if (!dto.totpCode) throw new UnauthorizedException('2FA code required');
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

    // Audit log
    await this.prisma.auditLog.create({
      data: { userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, ipAddress: ip },
    });

    return this.issueTokens(user.id, user.email, user.role);
  }

  // ─── Refresh ───────────────────────────────────────────────────────────────

  async refresh(token: string) {
    const stored = await this.redis.get(`refresh:${token}`);
    if (!stored) throw new UnauthorizedException('Refresh token expired or invalid');

    const { userId } = JSON.parse(stored);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found or suspended');

    // Rotation — delete old, issue new
    await this.redis.del(`refresh:${token}`);
    return this.issueTokens(user.id, user.email, user.role);
  }

  // ─── Logout ────────────────────────────────────────────────────────────────

  async logout(userId: string, refreshToken: string, accessToken?: string) {
    // Delete refresh token from Redis
    await this.redis.del(`refresh:${refreshToken}`);

    // Blacklist the access token for its remaining TTL (~15 min)
    if (accessToken) {
      await this.redis.set(`blacklist:${accessToken}`, '1', 900);
    }

    await this.prisma.auditLog.create({
      data: { userId, action: 'LOGOUT', entityType: 'User', entityId: userId },
    });

    this.logger.log(`User logged out: ${userId}`);
    return { message: 'Logged out successfully' };
  }

  // ─── Get current user ──────────────────────────────────────────────────────

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: {
        id:           true,
        email:        true,
        phone:        true,
        role:         true,
        kycStatus:    true,
        twoFaEnabled: true,
        isActive:     true,
        createdAt:    true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ─── 2FA Setup ─────────────────────────────────────────────────────────────

  async setup2FA(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user)              throw new NotFoundException('User not found');
    if (user.twoFaEnabled)  throw new BadRequestException('2FA already enabled');

    const secret = speakeasy.generateSecret({ name: 'Stablecoin Ecosystem', length: 32 });

    // Store temporarily — 5 min window to verify
    await this.redis.set(`2fa:pending:${userId}`, secret.base32, 300);

    return { secret: secret.base32, otpauthUrl: secret.otpauth_url };
  }

  async verify2FA(userId: string, token: string) {
    const secret = await this.redis.get(`2fa:pending:${userId}`);
    if (!secret) throw new BadRequestException('2FA setup expired. Start again.');

    const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 });
    if (!valid) throw new BadRequestException('Invalid code');

    await this.prisma.user.update({
      where: { id: userId },
      data:  { twoFaEnabled: true, twoFaSecret: secret },
    });

    await this.redis.del(`2fa:pending:${userId}`);
    return { message: '2FA enabled successfully' };
  }

  async disable2FA(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFaEnabled) throw new BadRequestException('2FA not enabled');

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

  // ─── Change password ───────────────────────────────────────────────────────

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Invalidate all existing sessions
    await this.redis.del(`refresh:*`);

    await this.prisma.auditLog.create({
      data: { userId, action: 'PASSWORD_CHANGE', entityType: 'User', entityId: userId },
    });

    return { message: 'Password changed successfully. Please log in again.' };
  }

  // ─── Token issuing ─────────────────────────────────────────────────────────

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
      60 * 60 * 24 * 7,   // 7 days
    );

    return { accessToken, refreshToken };
  }
}
