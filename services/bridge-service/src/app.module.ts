import { Module }       from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule }   from '@nestjs/bull';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule }  from './redis/redis.module';
import { BridgeModule } from './bridge/bridge.module';

function parseRedisUrl(url: string) {
  const m = url.match(/redis:\/\/:(.+)@(.+):(\d+)/);
  if (m) return { host:m[2], port:parseInt(m[3]), password:decodeURIComponent(m[1]) };
  return { host:'127.0.0.1', port:6379 };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal:true }),
    BullModule.forRootAsync({
      useFactory: () => ({ redis: parseRedisUrl(process.env.REDIS_URL ?? '') }),
    }),
    PrismaModule,
    RedisModule,
    BridgeModule,
  ],
})
export class AppModule {}
