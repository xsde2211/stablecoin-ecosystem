import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy }                  from '@nestjs/passport';
import { ExtractJwt, Strategy }              from 'passport-jwt';
import { RedisService }                      from '../redis/redis.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private redis: RedisService) {
    super({
      jwtFromRequest:    ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration:  false,
      secretOrKey:       process.env.JWT_SECRET!,
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: any) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (token) {
      const blacklisted = await this.redis.exists(`blacklist:${token}`);
      if (blacklisted) throw new UnauthorizedException('Token has been revoked');
    }

    const suspended = await this.redis.exists(`suspended:${payload.sub}`);
    if (suspended) throw new UnauthorizedException('Account suspended');

    return { sub: payload.sub, email: payload.email, role: payload.role };
  }
}
