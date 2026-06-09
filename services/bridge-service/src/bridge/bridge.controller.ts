import {
  Controller, Post, Get, Body, Param,
  Req, UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { BridgeService } from './bridge.service';
import { InitiateBridgeDto, BurnBridgeDto, ValidatorSignatureDto } from './dto/bridge.dto';

@ApiTags('Bridge')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('bridge')
export class BridgeController {
  constructor(private bridge: BridgeService) {}

  // ─── Routes ────────────────────────────────────────────────────

  @Get('routes')
  @ApiOperation({ summary: 'Get all supported bridge routes and tokens' })
  routes() {
    return this.bridge.getSupportedRoutes();
  }

  @Get('estimate')
  @ApiOperation({ summary: 'Estimate bridge fee for a transfer' })
  @ApiQuery({ name: 'srcChain',  example: 'tron'    })
  @ApiQuery({ name: 'dstChain',  example: 'sepolia' })
  @ApiQuery({ name: 'token',     example: 'INRX'    })
  @ApiQuery({ name: 'amount',    example: '1000'    })
  estimate(
    @Query('srcChain')  srcChain: string,
    @Query('dstChain')  dstChain: string,
    @Query('token')     token:    string,
    @Query('amount')    amount:   string,
  ) {
    return this.bridge.estimateFee(srcChain, dstChain, token, amount);
  }

  // ─── Initiate (Lock) ───────────────────────────────────────────

  @Post('initiate')
  @ApiOperation({
    summary: 'Initiate a cross-chain transfer (Lock)',
    description: 'Creates transfer record, queues relayer lock. Also returns calldata if user wants to call lock() directly.',
  })
  initiate(@Req() req: any, @Body() dto: InitiateBridgeDto) {
    return this.bridge.initiate(req.user.sub, req.user.walletAddress ?? '', dto);
  }

  // ─── Burn (Reverse) ────────────────────────────────────────────

  @Post('burn')
  @ApiOperation({
    summary: 'Return bridged tokens to original chain (Burn)',
    description: 'Burns tokens on destination chain so they can be unlocked on source chain.',
  })
  burn(@Req() req: any, @Body() dto: BurnBridgeDto) {
    return this.bridge.initiateBurn(req.user.sub, req.user.walletAddress ?? '', dto);
  }

  // ─── Validator signature ───────────────────────────────────────

  @Post('validator/sign')
  @ApiOperation({ summary: 'Validator submits signature for a transfer (internal/validator only)' })
  validatorSign(@Body() dto: ValidatorSignatureDto) {
    return this.bridge.submitValidatorSignature(dto);
  }

  // ─── Lock confirmation webhook (from listener-service) ─────────

  @Post('confirm-lock')
  @ApiOperation({ summary: 'Listener service confirms a lock event on-chain' })
  confirmLock(
    @Body('txHash')  txHash: string,
    @Body('chain')   chain:  string,
    @Body('nonce')   nonce:  string,
  ) {
    return this.bridge.confirmLock(txHash, chain, nonce);
  }

  // ─── Query ─────────────────────────────────────────────────────

  @Get('transfer/:id')
  @ApiOperation({ summary: 'Get bridge transfer details by ID' })
  getTransfer(@Param('id') id: string) {
    return this.bridge.getTransfer(id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get current user bridge transfer history (paginated)' })
  history(
    @Req() req: any,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.bridge.getUserTransfers(req.user.sub, page, limit);
  }

  @Get('pending')
  @ApiOperation({ summary: 'Get all pending transfers awaiting validator signatures (admin/validator)' })
  pending(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.bridge.getTransfersByStatus('LOCKED', page, limit);
  }
}
