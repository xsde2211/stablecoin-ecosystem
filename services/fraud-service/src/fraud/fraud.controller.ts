import { Controller, Get, Post, Body, Param, Req, UseGuards, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard }      from '@nestjs/passport';
import { FraudService }   from './fraud.service';
import { ScoreDto }       from './dto/score.dto';
import { BlacklistDto }   from './dto/blacklist.dto';
import { ResolveFlagDto } from './dto/resolve-flag.dto';

@ApiTags('Fraud')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('fraud')
export class FraudController {
  constructor(private svc: FraudService) {}

  @Post('score')
  @ApiOperation({
    summary:     'Score a transaction for fraud risk',
    description: 'Returns riskScore (0-100), action (ALLOW/REVIEW/BLOCK), and triggered flags. Called by wallet/bridge services before processing.',
  })
  score(@Body() dto: ScoreDto) { return this.svc.score(dto); }

  @Get('flags')
  @ApiOperation({ summary:'Get fraud flag review queue (admin)' })
  @ApiQuery({ name:'page',  required:false, type:Number })
  @ApiQuery({ name:'limit', required:false, type:Number })
  @ApiQuery({ name:'status',required:false, enum:['PENDING','CONFIRMED_FRAUD','FALSE_POSITIVE','RESOLVED'] })
  flags(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page:number,
    @Query('limit',new DefaultValuePipe(20),ParseIntPipe) limit:number,
    @Query('status') status?: string,
  ) { return this.svc.getFlags(page, limit, status); }

  @Post('flags/:id/resolve')
  @ApiOperation({ summary:'Resolve a fraud flag — CONFIRMED_FRAUD auto-suspends user' })
  resolve(@Param('id') id:string, @Body() dto:ResolveFlagDto, @Req() req:any) {
    return this.svc.resolveFlag(id, dto, req.user.sub);
  }

  @Post('blacklist')
  @ApiOperation({ summary:'Add address to fraud blacklist' })
  blacklist(@Body() dto: BlacklistDto, @Req() req:any) { return this.svc.addToBlacklist(dto, req.user.sub); }

  @Get('blacklist')
  @ApiOperation({ summary:'Get blacklisted addresses' })
  @ApiQuery({ name:'page',  required:false, type:Number })
  @ApiQuery({ name:'limit', required:false, type:Number })
  getBlacklist(@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number, @Query('limit',new DefaultValuePipe(50),ParseIntPipe) limit:number) {
    return this.svc.getBlacklist(page, limit);
  }

  @Get('stats')
  @ApiOperation({ summary:'Fraud detection stats — flag counts, accuracy rate' })
  stats() { return this.svc.getStats(); }
}
