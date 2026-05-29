import { Module }       from '@nestjs/common';
import { BullModule }   from '@nestjs/bull';
import { PassportModule } from '@nestjs/passport';
import { JwtModule }    from '@nestjs/jwt';
import { BridgeController } from './bridge.controller';
import { BridgeService }    from './bridge.service';
import { BridgeProcessor }  from './bridge.processor';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    BullModule.registerQueue({ name: 'bridge' }),
  ],
  controllers: [BridgeController],
  providers:   [BridgeService, BridgeProcessor],
})
export class BridgeModule {}