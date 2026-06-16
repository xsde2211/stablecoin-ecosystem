import { Module }         from '@nestjs/common';
import { HttpModule }      from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { JwtModule }      from '@nestjs/jwt';
import { ProxyController } from './proxy.controller';
import { ProxyService }    from './proxy.service';
import { JwtStrategy }     from '../auth/jwt.strategy';

@Module({
  imports: [
    HttpModule.register({ timeout: 30_000 }),
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [ProxyController],
  providers:   [ProxyService, JwtStrategy],
})
export class ProxyModule {}
