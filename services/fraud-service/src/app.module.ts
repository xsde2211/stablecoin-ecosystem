import { Module }        from '@nestjs/common';
import { ConfigModule }  from '@nestjs/config';
import { PrismaModule }  from './prisma/prisma.module';
import { RedisModule }   from './redis/redis.module';
import { FraudModule }   from './fraud/fraud.module';
@Module({ imports:[ConfigModule.forRoot({isGlobal:true}),PrismaModule,RedisModule,FraudModule] })
export class AppModule {}
