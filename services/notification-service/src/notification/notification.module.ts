import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
@Module({
  imports: [PassportModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
