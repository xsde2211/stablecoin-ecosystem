import { Module }         from '@nestjs/common';
import { ConfigModule }   from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule }   from './prisma/prisma.module';
import { RedisModule }    from './redis/redis.module';
import { PaymentModule }  from './payment/payment.module';
@Module({
  imports: [ConfigModule.forRoot({ isGlobal:true }), ScheduleModule.forRoot(), PrismaModule, RedisModule, PaymentModule],
})
export class AppModule {}
