import {
  Injectable, CanActivate, ExecutionContext, UnauthorizedException,
} from '@nestjs/common';
import { RedisService }  from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtRefreshGuard implements CanActivate {
  constructor(
    private redis:  RedisService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const refreshToken: string | undefined = req.body?.refreshToken;
    if (!refreshToken) throw new UnauthorizedException('Refresh token missing');

    const stored = await this.redis.get(`refresh:${refreshToken}`);
    if (!stored) throw new UnauthorizedException('Refresh token expired or already used');

    const { userId } = JSON.parse(stored);

    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    if (!user.isActive) {
      await this.redis.del(`refresh:${refreshToken}`);
      throw new UnauthorizedException('Account suspended');
    }

    req.user = { sub: user.id, email: user.email, role: user.role, refreshToken };
    return true;
  }
}