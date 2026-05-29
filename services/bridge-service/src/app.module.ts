import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule }   from '@nestjs/bull';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule }  from './redis/redis.module';
import { BridgeModule } from './bridge/bridge.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      redis: process.env.REDIS_URL,
    }),
    PrismaModule,
    RedisModule,
    BridgeModule,
  ],
})
export class AppModule {}