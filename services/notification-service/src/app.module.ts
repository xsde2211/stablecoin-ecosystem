import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { NotificationModule } from "./notification/notification.module";
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, RedisModule, NotificationModule] })
export class AppModule {}
