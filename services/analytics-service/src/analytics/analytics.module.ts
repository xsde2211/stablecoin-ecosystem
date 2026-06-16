import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule }      from '@nestjs/jwt';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService }    from './analytics.service';
import { JwtStrategy }         from '../auth/jwt.strategy';
@Module({
  imports:[PassportModule.register({defaultStrategy:'jwt'}),JwtModule.register({secret:process.env.JWT_SECRET})],
  controllers:[AnalyticsController], providers:[AnalyticsService,JwtStrategy],
})
export class AnalyticsModule {}
