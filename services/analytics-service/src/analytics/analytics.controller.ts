import { Controller, Get, UseGuards, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard }          from '@nestjs/passport';
import { AnalyticsService }   from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('analytics')
export class AnalyticsController {
  constructor(private svc: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary:'Overview dashboard — totals (cached 1 min)' })
  dashboard() { return this.svc.getDashboard(); }

  @Get('volume/chain')
  @ApiOperation({ summary:'Transaction volume grouped by chain' })
  @ApiQuery({ name:'days', required:false, type:Number })
  volumeByChain(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days:number) {
    return this.svc.getVolumeByChain(days);
  }

  @Get('volume/token')
  @ApiOperation({ summary:'Transaction volume grouped by token (INRX/EGOLD/ESLVR)' })
  @ApiQuery({ name:'days', required:false, type:Number })
  volumeByToken(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days:number) {
    return this.svc.getVolumeByToken(days);
  }

  @Get('volume/daily')
  @ApiOperation({ summary:'Daily volume time-series for charts' })
  @ApiQuery({ name:'days', required:false, type:Number })
  dailyVolume(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days:number) {
    return this.svc.getDailyVolume(days);
  }

  @Get('bridge')
  @ApiOperation({ summary:'Bridge transfer stats — success rate, volume by route' })
  @ApiQuery({ name:'days', required:false, type:Number })
  bridgeStats(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days:number) {
    return this.svc.getBridgeStats(days);
  }

  @Get('top-users')
  @ApiOperation({ summary:'Top users ranked by transaction volume' })
  @ApiQuery({ name:'limit', required:false, type:Number })
  @ApiQuery({ name:'days',  required:false, type:Number })
  topUsers(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit:number,
    @Query('days',  new DefaultValuePipe(30), ParseIntPipe) days:number,
  ) { return this.svc.getTopUsers(limit, days); }
}
