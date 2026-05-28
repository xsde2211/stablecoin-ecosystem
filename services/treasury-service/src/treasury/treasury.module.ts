import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { TreasuryController } from "./treasury.controller";
import { TreasuryService } from "./treasury.service";
@Module({
  imports: [PassportModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [TreasuryController],
  providers: [TreasuryService],
})
export class TreasuryModule {}
