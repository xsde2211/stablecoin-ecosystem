import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";
@Module({
  imports: [PassportModule, JwtModule.register({ secret: process.env.JWT_SECRET })],
  controllers: [PaymentController],
  providers: [PaymentService],
})
export class PaymentModule {}
