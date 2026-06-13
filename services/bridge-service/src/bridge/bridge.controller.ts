import {
  Controller, Post, Get, Body, Param,
  Req, UseGuards, Query, ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard }       from '@nestjs/passport';
import { BridgeService }   from './bridge.service';
import { InitiateBridgeDto } from './dto/initiate-bridge.dto';
import { BurnBridgeDto }     from './dto/burn-bridge.dto';

@ApiTags('Bridge')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('bridge')
export class BridgeController {
  constructor(private bridge: BridgeService) {}

  @Post('initiate')
  @ApiOperation({
    summary:     'Initiate cross-chain bridge transfer (LOCK flow)',
    description: 'Locks tokens on source chain. Relayer mints on destination after validator signatures.',
  })
  initiate(@Req() req: any, @Body() dto: InitiateBridgeDto) {
    return this.bridge.initiate(req.user.sub, dto);
  }

  @Post('burn')
  @ApiOperation({
    summary:     'Burn tokens to return to source chain (BURN→UNLOCK flow)',
    description: 'Burns bridged tokens on current chain. Relayer unlocks originals on source chain.',
  })
  burn(@Req() req: any, @Body() dto: BurnBridgeDto) {
    return this.bridge.initiateBurn(req.user.sub, dto);
  }

  @Get('transfer/:id')
  @ApiOperation({ summary: 'Get bridge transfer status and validator signatures' })
  getTransfer(@Param('id') id: string, @Req() req: any) {
    return this.bridge.getTransfer(id, req.user.sub);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get paginated bridge transfer history' })
  @ApiQuery({ name:'page',  required:false, type:Number })
  @ApiQuery({ name:'limit', required:false, type:Number })
  history(
    @Req() req: any,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.bridge.getUserTransfers(req.user.sub, page, limit);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get bridge contract status across all chains' })
  status() {
    return this.bridge.getBridgeStatus();
  }
}
