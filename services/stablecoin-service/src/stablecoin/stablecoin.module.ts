import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { StablecoinController } from "./stablecoin.controller";
import { StablecoinService } from "./stablecoin.service";

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [StablecoinController],
  providers: [StablecoinService],
  exports: [StablecoinService],
})
export class StablecoinModule {}
