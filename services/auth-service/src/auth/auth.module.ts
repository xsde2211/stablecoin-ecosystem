// services/auth-service/src/auth/auth.module.ts
import { Module }         from '@nestjs/common';
import { JwtModule }      from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController }     from './auth.controller';
import { AuthService }        from './auth.service';
import { JwtStrategy }        from './jwt.strategy';
import { JwtRefreshStrategy } from './jwt-refresh.strategy'; // ← add

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtRefreshStrategy, // ← add
  ],
  exports: [JwtStrategy, JwtRefreshStrategy],
})
export class AuthModule {}