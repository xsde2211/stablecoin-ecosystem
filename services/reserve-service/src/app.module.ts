import { Module }        from '@nestjs/common';
import { ConfigModule }  from '@nestjs/config';
import { PrismaModule }  from './prisma/prisma.module';
import { RedisModule }   from './redis/redis.module';
import { ReserveModule } from './reserve/reserve.module';
@Module({
  imports: [ConfigModule.forRoot({ isGlobal:true }), PrismaModule, RedisModule, ReserveModule],
})
export class AppModule {}
