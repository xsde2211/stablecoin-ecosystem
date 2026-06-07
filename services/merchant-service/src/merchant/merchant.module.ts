import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { MerchantController } from "./merchant.controller";
import { MerchantService } from "./merchant.service";
import { JwtStrategy } from '../auth/jwt.strategy';
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [MerchantController],
  providers: [MerchantService, JwtStrategy],
})
export class MerchantModule {}
