import {
  Controller, Get, Post, Body,
  Param, Req, UseGuards, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard }         from '@nestjs/passport';
import { StablecoinService } from './stablecoin.service';
import { MintDto }           from './dto/mint.dto';
import { BurnDto }           from './dto/burn.dto';

@ApiTags('Stablecoin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('stablecoin')
export class StablecoinController {
  constructor(private svc: StablecoinService) {}

  @Get('info/:token/:chain')
  @ApiOperation({ summary: 'Get token info on a specific chain — supply, cap, paused status' })
  info(@Param('token') token: string, @Param('chain') chain: string) {
    return this.svc.getTokenInfo(token, chain);
  }

  @Get('info/:token')
  @ApiOperation({ summary: 'Get token info across all chains (ethereum, bsc, polygon)' })
  infoAllChains(@Param('token') token: string) {
    return this.svc.getTokenInfoAllChains(token);
  }

  @Get('supply')
  @ApiOperation({ summary: 'Get supply for all tokens (INRX/EGOLD/ESLVR) across all chains' })
  supply() {
    return this.svc.getTotalSupplyAllTokens();
  }

  @Get('oracle/:token/:chain')
  @ApiOperation({ summary: 'Get current oracle price for eGold or eSilver on a specific chain' })
  oraclePrice(@Param('token') token: string, @Param('chain') chain: string) {
    return this.svc.getOraclePrice(token, chain);
  }

  @Get('oracle/:token')
  @ApiOperation({ summary: 'Get oracle prices for a token across all chains' })
  oraclePricesAllChains(@Param('token') token: string) {
    return this.svc.getOraclePricesAllChains(token);
  }

  @Get('reserve/:token/:chain')
  @ApiOperation({
    summary:     'Get proof of reserve for a token on a chain',
    description: 'Returns totalReserve, circulatingSupply, backingRatioBps, isFullyBacked, lastAudit',
  })
  proofOfReserve(@Param('token') token: string, @Param('chain') chain: string) {
    return this.svc.getProofOfReserve(token, chain);
  }

  @Get('check-address/:chain/:address')
  @ApiOperation({ summary: 'Check if an address is blacklisted or frozen on any token' })
  checkAddress(@Param('chain') chain: string, @Param('address') address: string) {
    return this.svc.checkAddress(address, chain);
  }

  @Post('mint')
  @ApiOperation({
    summary:     'Direct mint — FOR TESTING ONLY',
    description: 'Bypasses TreasuryTimelock. In production, use treasury/propose instead.',
  })
  mint(@Body() dto: MintDto, @Req() req: any) {
    return this.svc.mintTokens(dto, req.user.sub);
  }

  @Post('burn')
  @ApiOperation({
    summary:     'Direct burn — FOR TESTING ONLY',
    description: 'Bypasses TreasuryTimelock. In production, use treasury/propose instead.',
  })
  burn(@Body() dto: BurnDto, @Req() req: any) {
    return this.svc.burnTokens(dto, req.user.sub);
  }
}

// Separate, UNGUARDED controller for live market prices — this is the same
// public market data already shown on the public dashboard (no user-specific
// info), so it doesn't require a JWT. wallet-service calls this directly
// (service-to-service, not through the gateway) to compute each holding's
// current market value without touching on-chain balances.
@ApiTags('Stablecoin')
@Controller('stablecoin')
export class PriceController {
  constructor(private svc: StablecoinService) {}

  @Get('live-prices')
  @ApiOperation({
    summary: 'Live USD/INR rate + per-token market prices (INRX/EGOLD/ESLVR)',
    description:
      'Token quantities are fixed — only their value floats with real-world INR/gold/silver ' +
      'prices. This is what wallet-service multiplies against each holding\'s balance to show ' +
      'current market value, and mirrors the same pricing logic used by the public dashboard.',
  })
  livePrices() {
    return this.svc.getLivePrices();
  }
}

// Separate, UNGUARDED controller — same pattern as PriceController above.
// This is the public INRXScan-style explorer: anyone can list/search/filter
// every INRX transaction (mint, burn, send/receive, swap, bridge) across
// every chain, and look up any address, without a JWT — that's the entire
// point of a public ledger explorer. It intentionally reads across ALL
// wallets, not just the caller's own.
@ApiTags('Explorer')
@Controller('stablecoin/explorer')
export class ExplorerController {
  constructor(private svc: StablecoinService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Live INRX stats: circulating supply, tx counts, active wallets' })
  stats(@Query('token') token?: string) {
    return this.svc.explorerStats(token);
  }

  @Get('networks')
  @ApiOperation({ summary: 'Per-network display metadata: labels, native gas symbols, block explorer URLs' })
  networks() {
    return this.svc.explorerNetworks();
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List/search/filter INRX transactions across all wallets and chains' })
  @ApiQuery({ name: 'page',   required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'type',   required: false, description: 'SEND|MINT|BURN|BRIDGE_LOCK|BRIDGE_MINT|SWAP' })
  @ApiQuery({ name: 'chain',  required: false, description: 'ethereum|bsc|polygon|tron|solana|all' })
  @ApiQuery({ name: 'q',      required: false, description: 'search by tx hash or address' })
  @ApiQuery({ name: 'from',   required: false, description: 'ISO date — start of range (inclusive)' })
  @ApiQuery({ name: 'to',     required: false, description: 'ISO date — end of range (inclusive)' })
  transactions(
    @Query('page') page?: string, @Query('limit') limit?: string,
    @Query('type') type?: string, @Query('chain') chain?: string, @Query('q') q?: string,
    @Query('from') from?: string, @Query('to') to?: string,
  ) {
    return this.svc.explorerTransactions({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      type, chain, q, from, to,
    });
  }

  @Get('transactions/:hash')
  @ApiOperation({ summary: 'Single INRX transaction by hash' })
  transaction(@Param('hash') hash: string) {
    return this.svc.explorerTransaction(hash);
  }

  @Get('address/:address')
  @ApiOperation({ summary: 'INRX balance + transaction history for any address' })
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'chain', required: false })
  address(
    @Param('address') address: string,
    @Query('page') page?: string, @Query('limit') limit?: string, @Query('chain') chain?: string,
  ) {
    return this.svc.explorerAddress(address, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      chain,
    });
  }
}