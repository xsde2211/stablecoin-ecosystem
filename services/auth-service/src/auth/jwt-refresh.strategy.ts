// services/auth-service/src/auth/jwt-refresh.strategy.ts
import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { RedisService }  from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * JWT Refresh Strategy
 *
 * Used only on the POST /auth/refresh endpoint.
 * Validates the refresh token from the request body,
 * checks it exists in Redis, returns the user payload.
 *
 * Separate from JwtStrategy (which handles access tokens)
 * because refresh tokens have different validation logic.
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private redis:  RedisService,
    private prisma: PrismaService,
  ) {
    super({
      // Extract refresh token from request body field "refreshToken"
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),

      // Refresh tokens can be expired JWT — we validate expiry ourselves via Redis TTL
      ignoreExpiration: true,

      secretOrKey: process.env.JWT_REFRESH_SECRET!,

      // Pass full request so we can read body in validate()
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any) {
    const refreshToken = req.body?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }

    // Check token exists in Redis
    // Key format: refresh:<token>  Value: { userId }
    const stored = await this.redis.get(`refresh:${refreshToken}`);
    if (!stored) {
      throw new UnauthorizedException('Refresh token expired or already used');
    }

    const { userId } = JSON.parse(stored);

    // Verify userId in token matches stored userId
    if (payload.sub !== userId) {
      throw new UnauthorizedException('Refresh token mismatch');
    }

    // Check user still exists and is active
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id:       true,
        email:    true,
        role:     true,
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.isActive) {
      // Clean up Redis entry for suspended user
      await this.redis.del(`refresh:${refreshToken}`);
      throw new UnauthorizedException('Account suspended');
    }

    // Attach to request — available in controller as req.user
    return {
      sub:          user.id,
      email:        user.email,
      role:         user.role,
      refreshToken, // controller needs this to delete old token
    };
  }
}