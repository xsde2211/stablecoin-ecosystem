import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { TreasuryController } from "./treasury.controller";
import { TreasuryService } from "./treasury.service";
import { JwtStrategy } from '../auth/jwt.strategy';
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [TreasuryController],
  providers: [TreasuryService, JwtStrategy],
})
export class TreasuryModule {}
