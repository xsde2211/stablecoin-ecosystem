import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycProviderService } from './kyc.provider.service';
import { JwtStrategy } from '../auth/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [KycController],
  providers:   [KycService, KycProviderService, JwtStrategy],
  exports:     [KycService],
})
export class KycModule {}
