import { Module }       from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD }    from '@nestjs/core';
import { ProxyModule }  from './proxy/proxy.module';
import { RedisModule }  from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{
      name:  'global',
      ttl:   60_000,
      limit: 100,
    }]),
    RedisModule,
    ProxyModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}