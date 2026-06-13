import { Module }         from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule }      from '@nestjs/jwt';
import { BullModule }     from '@nestjs/bull';
import { BridgeController } from './bridge.controller';
import { BridgeService }    from './bridge.service';
import { BridgeProcessor }  from './bridge.processor';
import { JwtStrategy }      from '../auth/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy:'jwt' }),
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    BullModule.registerQueue({ name:'bridge' }),
  ],
  controllers: [BridgeController],
  providers:   [BridgeService, BridgeProcessor, JwtStrategy],
})
export class BridgeModule {}
