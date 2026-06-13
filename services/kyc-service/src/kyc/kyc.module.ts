import { Module }         from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule }      from '@nestjs/jwt';
import { KycController }  from './kyc.controller';
import { KycService }     from './kyc.service';
import { JwtStrategy }    from '../auth/jwt.strategy';
@Module({
  imports: [PassportModule.register({ defaultStrategy:'jwt' }), JwtModule.register({ secret:process.env.JWT_SECRET })],
  controllers: [KycController],
  providers:   [KycService, JwtStrategy],
})
export class KycModule {}
