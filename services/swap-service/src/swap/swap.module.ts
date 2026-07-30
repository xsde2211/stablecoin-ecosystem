import { Module }         from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SwapController } from './swap.controller';
import { SwapService }    from './swap.service';
import { PriceService }   from './price.service';
import { JwtStrategy }    from '../auth/jwt.strategy';

@Module({
  imports:     [PassportModule],
  controllers: [SwapController],
  providers:   [SwapService, PriceService, JwtStrategy],
})
export class SwapModule {}
