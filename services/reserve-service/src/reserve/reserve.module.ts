import { Module }         from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule }      from '@nestjs/jwt';
import { ReserveController } from './reserve.controller';
import { ReserveService }    from './reserve.service';
import { JwtStrategy }       from '../auth/jwt.strategy';
@Module({
  imports: [PassportModule.register({ defaultStrategy:'jwt' }), JwtModule.register({ secret:process.env.JWT_SECRET })],
  controllers: [ReserveController],
  providers:   [ReserveService, JwtStrategy],
})
export class ReserveModule {}
