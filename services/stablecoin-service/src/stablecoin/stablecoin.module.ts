import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { StablecoinController } from './stablecoin.controller';
import { StablecoinService } from './stablecoin.service';
import { JwtStrategy } from '../auth/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [StablecoinController],
  providers:   [StablecoinService, JwtStrategy],
  exports:     [StablecoinService],
})
export class StablecoinModule {}
