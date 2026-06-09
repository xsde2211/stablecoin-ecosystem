import {
  Controller, Get, Post, Body, Param,
  Req, UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { StablecoinService } from './stablecoin.service';
import {
  MintDto, BurnDto,
  TreasuryProposeDto, TreasurySignDto, TreasuryExecuteDto,
  ComplianceActionDto,
} from './dto/stablecoin.dto';

@ApiTags('Stablecoin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('stablecoin')
export class StablecoinController {
  constructor(private svc: StablecoinService) {}

  // ─── Token Info ──────────────────────────────────────────────────

  @Get('info/:token/:chain')
  @ApiOperation({ summary: 'Get token info on a specific chain (supply, price, paused status)' })
  info(@Param('token') token: string, @Param('chain') chain: string) {
    return this.svc.getTokenInfo(token, chain);
  }

  @Get('info/:token')
  @ApiOperation({ summary: 'Get token info across ALL chains (sepolia, bsc, polygon, tron)' })
  infoAllChains(@Param('token') token: string) {
    return this.svc.getTokenInfoAllChains(token);
  }

  @Get('supply')
  @ApiOperation({ summary: 'Get total supply of all tokens (INRX, EGOLD, ESLVR) across all chains' })
  supply() {
    return this.svc.getTotalSupplyAllTokens();
  }

  // ─── Oracle Prices ───────────────────────────────────────────────

  @Get('prices')
  @ApiOperation({ summary: 'Get current prices of all tokens from OracleManager (median)' })
  allPrices() {
    return this.svc.getAllPrices();
  }

  @Get('price/:token/:chain')
  @ApiOperation({ summary: 'Get current price of a token on a chain from OracleManager' })
  price(@Param('token') token: string, @Param('chain') chain: string) {
    return this.svc.getTokenPrice(token, chain);
  }

  @Get('oracle/:token/:chain')
  @ApiOperation({ summary: 'Get all registered oracles and their prices for a token on a chain' })
  oracleDetails(@Param('token') token: string, @Param('chain') chain: string) {
    return this.svc.getOracleDetails(token, chain);
  }

  // ─── Proof of Reserve ────────────────────────────────────────────

  @Get('reserve/proof')
  @ApiOperation({ summary: 'Get proof of reserve snapshot for all tokens on all EVM chains' })
  allReserves() {
    return this.svc.getAllReservesProof();
  }

  @Get('reserve/proof/:token/:chain')
  @ApiOperation({ summary: 'Get proof of reserve for a specific token on a chain' })
  reserveProof(@Param('token') token: string, @Param('chain') chain: string) {
    return this.svc.getProofOfReserve(token, chain);
  }

  @Get('reserve/entries/:token/:chain')
  @ApiOperation({ summary: 'Get all active reserve entries for a token (custodian records)' })
  reserveEntries(@Param('token') token: string, @Param('chain') chain: string) {
    return this.svc.getActiveReserves(token, chain);
  }

  @Get('reserve/audits/:token/:chain')
  @ApiOperation({ summary: 'Get audit history for a token on a chain' })
  auditHistory(@Param('token') token: string, @Param('chain') chain: string) {
    return this.svc.getAuditHistory(token, chain);
  }

  // ─── Treasury Timelock ───────────────────────────────────────────

  @Get('treasury/config/:chain')
  @ApiOperation({ summary: 'Get treasury timelock config (required sigs, delay, daily limits)' })
  treasuryConfig(@Param('chain') chain: string) {
    return this.svc.getTreasuryConfig(chain);
  }

  @Get('treasury/operation/:token/:chain/:opId')
  @ApiOperation({ summary: 'Get a specific treasury operation by ID' })
  getOperation(
    @Param('token') token: string,
    @Param('chain') chain: string,
    @Param('opId')  opId: string,
  ) {
    return this.svc.getTreasuryOperation(token, chain, parseInt(opId));
  }

  @Post('treasury/propose')
  @ApiOperation({
    summary: 'Propose a mint/burn/pause/unpause via TreasuryTimelock (signer only)',
    description: 'Requires SIGNER_ROLE on the TreasuryTimelock contract. Operation enters 12h timelock after M-of-N approvals.',
  })
  treasuryPropose(@Body() dto: TreasuryProposeDto, @Req() req: any) {
    return this.svc.treasuryPropose(dto, req.user.sub);
  }

  @Post('treasury/sign')
  @ApiOperation({ summary: 'Sign a pending treasury operation (signer only)' })
  treasurySign(@Body() dto: TreasurySignDto, @Req() req: any) {
    return this.svc.treasurySign(dto, req.user.sub);
  }

  @Post('treasury/execute')
  @ApiOperation({ summary: 'Execute a queued treasury operation after timelock delay (anyone)' })
  treasuryExecute(@Body() dto: TreasuryExecuteDto, @Req() req: any) {
    return this.svc.treasuryExecute(dto, req.user.sub);
  }

  // ─── Direct Mint / Burn (requires role key in env) ───────────────

  @Post('mint')
  @ApiOperation({
    summary: 'Directly mint tokens (requires MINTER_PRIVATE_KEY in env)',
    description: 'For production use treasury/propose instead. This directly calls mint() on the token contract.',
  })
  mint(@Body() dto: MintDto, @Req() req: any) {
    return this.svc.mintTokens(dto, req.user.sub);
  }

  @Post('burn')
  @ApiOperation({
    summary: 'Directly burn tokens (requires BURNER_PRIVATE_KEY in env)',
    description: 'For production use treasury/propose instead.',
  })
  burn(@Body() dto: BurnDto, @Req() req: any) {
    return this.svc.burnTokens(dto, req.user.sub);
  }

  // ─── Compliance ──────────────────────────────────────────────────

  @Get('compliance/check/:token/:chain/:address')
  @ApiOperation({ summary: 'Check if an address is blacklisted or frozen for a token on a chain' })
  checkCompliance(
    @Param('token')   token:   string,
    @Param('chain')   chain:   string,
    @Param('address') address: string,
  ) {
    return this.svc.checkCompliance(token, chain, address);
  }

  @Post('compliance/blacklist')
  @ApiOperation({ summary: 'Blacklist/un-blacklist an address (requires COMPLIANCE_KEY in env)' })
  blacklist(@Body() dto: ComplianceActionDto, @Req() req: any) {
    return this.svc.blacklistAddress(dto, req.user.sub);
  }

  @Post('compliance/freeze')
  @ApiOperation({ summary: 'Freeze/un-freeze an address (requires COMPLIANCE_KEY in env)' })
  freeze(@Body() dto: ComplianceActionDto, @Req() req: any) {
    return this.svc.freezeAddress(dto, req.user.sub);
  }
}
