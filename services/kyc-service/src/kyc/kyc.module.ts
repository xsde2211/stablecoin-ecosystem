import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { KycController } from "./kyc.controller";
import { KycService } from "./kyc.service";
@Module({
  imports: [PassportModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [KycController],
  providers: [KycService],
})
export class KycModule {}
