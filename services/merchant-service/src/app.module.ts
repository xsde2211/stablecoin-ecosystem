import { Module }         from '@nestjs/common';
import { ConfigModule }   from '@nestjs/config';
import { PrismaModule }   from './prisma/prisma.module';
import { RedisModule }    from './redis/redis.module';
import { MerchantModule } from './merchant/merchant.module';
@Module({ imports:[ConfigModule.forRoot({isGlobal:true}),PrismaModule,RedisModule,MerchantModule] })
export class AppModule {}
