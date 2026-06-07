import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy }                  from '@nestjs/passport';
import { ExtractJwt, Strategy }              from 'passport-jwt';
import { Request }                           from 'express';
import { RedisService }                      from '../redis/redis.service';
import { PrismaService }                     from '../prisma/prisma.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(private redis: RedisService, private prisma: PrismaService) {
    super({
      jwtFromRequest:    ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration:  true,
      secretOrKey:       process.env.JWT_REFRESH_SECRET!,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any) {
    const refreshToken = (req.body as any)?.refreshToken;
    if (!refreshToken) throw new UnauthorizedException('Refresh token missing');

    const stored = await this.redis.get(`refresh:${refreshToken}`);
    if (!stored)  throw new UnauthorizedException('Refresh token expired or already used');

    const { userId } = JSON.parse(stored);
    if (payload.sub !== userId) throw new UnauthorizedException('Token mismatch');

    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id:true, email:true, role:true, isActive:true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.isActive) {
      await this.redis.del(`refresh:${refreshToken}`);
      throw new UnauthorizedException('Account suspended');
    }

    return { sub:user.id, email:user.email, role:user.role, refreshToken };
  }
}
