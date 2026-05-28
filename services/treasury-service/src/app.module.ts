import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { TreasuryModule } from "./treasury/treasury.module";
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, RedisModule, TreasuryModule] })
export class AppModule {}
