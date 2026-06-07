import { Module }         from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule }      from '@nestjs/jwt';
import { WalletController } from './wallet.controller';
import { WalletService }    from './wallet.service';
import { KmsService }       from './kms.service';
import { ChainService }     from './chain.service';
import { JwtStrategy }      from '../auth/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [WalletController],
  providers:   [WalletService, KmsService, ChainService, JwtStrategy],
})
export class WalletModule {}
