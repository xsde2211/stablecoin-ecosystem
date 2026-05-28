import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { ReserveController } from "./reserve.controller";
import { ReserveService } from "./reserve.service";
@Module({
  imports: [PassportModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [ReserveController],
  providers: [ReserveService],
})
export class ReserveModule {}
