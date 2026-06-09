import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { BridgeModule } from './bridge/bridge.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Parse REDIS_URL for Bull
    BullModule.forRootAsync({
      useFactory: () => {
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
        const match = url.match(/redis:\/\/:(.+)@(.+):(\d+)/);
        if (match) {
          return {
            redis: {
              host:     match[2],
              port:     parseInt(match[3]),
              password: decodeURIComponent(match[1]),
            },
          };
        }
        const simple = url.match(/redis:\/\/([^:]+):(\d+)/);
        if (simple) return { redis: { host: simple[1], port: parseInt(simple[2]) } };
        return { redis: { host: 'localhost', port: 6379 } };
      },
    }),

    PrismaModule,
    RedisModule,
    BridgeModule,
  ],
})
export class AppModule {}
