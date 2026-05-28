import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule }  from './prisma/prisma.module';
import { RedisModule }   from './redis/redis.module';
import { WalletModule }  from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    WalletModule,
  ],
})
export class AppModule {}