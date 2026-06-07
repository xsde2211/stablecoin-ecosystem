import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
import { JwtStrategy } from '../auth/jwt.strategy';
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [NotificationController],
  providers: [NotificationService, JwtStrategy],
  exports: [NotificationService],
})
export class NotificationModule {}
