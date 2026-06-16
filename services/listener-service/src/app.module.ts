import { Module }         from '@nestjs/common';
import { ConfigModule }   from '@nestjs/config';
import { PrismaModule }   from './prisma/prisma.module';
import { RedisModule }    from './redis/redis.module';
import { ListenerModule } from './listener/listener.module';
@Module({ imports:[ConfigModule.forRoot({isGlobal:true}),PrismaModule,RedisModule,ListenerModule] })
export class AppModule {}
