import { Module }         from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule }      from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { StablecoinController, PriceController, ExplorerController } from './stablecoin.controller';
import { StablecoinService }    from './stablecoin.service';
import { JwtStrategy }          from '../auth/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy:'jwt' }),
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    ScheduleModule.forRoot(),
  ],
  controllers: [StablecoinController, PriceController, ExplorerController],
  providers:   [StablecoinService, JwtStrategy],
})
export class StablecoinModule {}