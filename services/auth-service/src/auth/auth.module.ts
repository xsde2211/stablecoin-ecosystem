import { Module }         from '@nestjs/common';
import { JwtModule }      from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController }      from './auth.controller';
import { AuthService }         from './auth.service';
import { JwtStrategy }         from './jwt.strategy';
import { JwtRefreshStrategy }  from './jwt-refresh.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [AuthController],
  providers:   [AuthService, JwtStrategy, JwtRefreshStrategy],
  exports:     [JwtStrategy, JwtRefreshStrategy],
})
export class AuthModule {}
