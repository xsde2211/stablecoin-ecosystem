import { Module }         from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule }      from '@nestjs/jwt';
import { PaymentController } from './payment.controller';
import { PaymentService }    from './payment.service';
import { JwtStrategy }       from '../auth/jwt.strategy';
@Module({
  imports: [PassportModule.register({ defaultStrategy:'jwt' }), JwtModule.register({ secret:process.env.JWT_SECRET })],
  controllers: [PaymentController],
  providers:   [PaymentService, JwtStrategy],
})
export class PaymentModule {}
