import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { AnalyticsModule } from "./analytics/analytics.module";
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, RedisModule, AnalyticsModule] })
export class AppModule {}
