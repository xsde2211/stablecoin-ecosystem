// services/bridge-service/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule }   from '@nestjs/bull';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule }  from './redis/redis.module';
import { BridgeModule } from './bridge/bridge.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Fix: parse REDIS_URL properly for Bull
    BullModule.forRootAsync({
      useFactory: () => {
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
        // Parse redis://:password@host:port
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
        return { redis: { host: 'localhost', port: 6379 } };
      },
    }),

    PrismaModule,
    RedisModule,
    BridgeModule,
  ],
})
export class AppModule {}