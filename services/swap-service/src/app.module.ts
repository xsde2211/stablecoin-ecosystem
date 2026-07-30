import { Module }       from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule }  from './redis/redis.module';
import { SwapModule }   from './swap/swap.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    SwapModule,
  ],
})
export class AppModule {}
