import {
  Controller, Get, Post, Body, Req, UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard }   from '@nestjs/passport';
import { SwapService } from './swap.service';
import { QuoteDto }        from './dto/quote.dto';
import { ExecuteSwapDto }  from './dto/execute-swap.dto';

@ApiTags('Swap')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('swap')
export class SwapController {
  constructor(private svc: SwapService) {}

  @Get('networks')
  @ApiOperation({ summary: 'List networks the swap picker should offer, with which ones are actually live' })
  networks() {
    return this.svc.listNetworks();
  }

  @Get('tokens')
  @ApiOperation({ summary: 'List swappable tokens (INRX/EGOLD/ESLVR)' })
  tokens() {
    return this.svc.listTokens();
  }

  @Post('quote')
  @ApiOperation({
    summary:     'Get a swap quote',
    description: 'Converts fromToken to toToken on a single network at the live INR/gold/silver rate. Rate is locked for 30s.',
  })
  quote(@Body() dto: QuoteDto, @Req() req: any) {
    return this.svc.quote(dto, req.user.sub);
  }

  @Post('execute')
  @ApiOperation({ summary: 'Execute a swap from a quoteId returned by POST /swap/quote' })
  execute(@Body() dto: ExecuteSwapDto, @Req() req: any) {
    return this.svc.execute(dto.quoteId, req.user.sub, req.headers.authorization);
  }

  @Get('history')
  @ApiOperation({ summary: 'This user\'s past swaps' })
  @ApiQuery({ name: 'page',        required: false, type: Number })
  @ApiQuery({ name: 'limit',       required: false, type: Number })
  @ApiQuery({ name: 'walletIndex', required: false, type: Number, description: 'Scope to one wallet — omit to see swaps across all of this user\'s wallets' })
  history(
    @Req() req: any,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('walletIndex') walletIndex?: string,
  ) {
    return this.svc.getHistory(req.user.sub, page, limit, walletIndex !== undefined ? parseInt(walletIndex, 10) : undefined);
  }
}