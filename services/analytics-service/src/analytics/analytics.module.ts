import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
@Module({
  imports: [PassportModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
