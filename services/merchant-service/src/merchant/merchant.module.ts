import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { MerchantController } from "./merchant.controller";
import { MerchantService } from "./merchant.service";
@Module({
  imports: [PassportModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [MerchantController],
  providers: [MerchantService],
})
export class MerchantModule {}
