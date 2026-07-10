import {
  Controller, Get, Post, Body,
  Param, Req, UseGuards, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiBody } from '@nestjs/swagger';
import { AuthGuard }     from '@nestjs/passport';
import { TreasuryService } from './treasury.service';
import { ProposeDto }      from './dto/propose.dto';
import { SignDto }         from './dto/sign.dto';
import { CancelDto }       from './dto/cancel.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { TreasuryTeamGuard } from './treasury-team.guard';

@ApiTags('Treasury')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('treasury')
export class TreasuryController {
  constructor(private svc: TreasuryService) {}

  @Post('propose')
  @UseGuards(TreasuryTeamGuard)
  @ApiOperation({
    summary:     'Propose a mint/burn/pause operation directly (ad-hoc — not tied to a user request)',
    description: 'Creates an operation on-chain. Proposer auto-signs. Collect 2-of-3 signatures to queue for execution after 12h timelock. Signer/Guardian/Admin only.',
  })
  propose(@Body() dto: ProposeDto, @Req() req: any, @Query('signerIndex') signerIndex: string) {
    const idx = (parseInt(signerIndex) as 1 | 2 | 3) || 1;
    return this.svc.propose(dto, req.user.sub, idx);
  }

  @Post('sign')
  @UseGuards(TreasuryTeamGuard)
  @ApiOperation({
    summary:     'Sign a pending treasury operation',
    description: 'Adds your signature. When threshold reached, 12-hour timelock begins. Signer/Guardian/Admin only.',
  })
  sign(
    @Body() dto: SignDto,
    @Req() req: any,
    @Query('signerIndex') signerIndex: string,
  ) {
    const idx = (parseInt(signerIndex) as 1|2|3) || 1;
    return this.svc.sign(dto, req.user.sub, idx);
  }

  @Post('execute/:chain/:opId')
  @ApiOperation({
    summary:     'Execute a queued operation after timelock delay',
    description: 'Anyone can call this after the 12-hour window passes — this matches the contract itself being permissionless here.',
  })
  execute(@Param('chain') chain: string, @Param('opId') opId: string, @Req() req: any) {
    return this.svc.execute(chain, opId, req.user.sub);
  }

  @Post('cancel/:chain/:opId')
  @UseGuards(TreasuryTeamGuard)
  @ApiOperation({
    summary:     'Cancel a pending/queued operation (guardian only)',
    description: 'Guardian can cancel at any time before execution. This is the emergency stop. Treasury team/Admin only.',
  })
  cancel(
    @Param('chain') chain: string,
    @Param('opId')  opId:  string,
    @Body() dto: CancelDto,
    @Req() req: any,
  ) {
    return this.svc.cancel(chain, opId, dto.reason, req.user.sub);
  }

  @Get('operation/:chain/:opId')
  @ApiOperation({ summary: 'Get operation details including approvals, status, timelock countdown' })
  operation(@Param('chain') chain: string, @Param('opId') opId: string) {
    return this.svc.getOperation(chain, opId);
  }

  @Get('config/:chain')
  @ApiOperation({ summary: 'Get treasury config — required sigs, timelock delay, total ops' })
  config(@Param('chain') chain: string) {
    return this.svc.getConfig(chain);
  }

  @Get('daily-limits/:chain')
  @ApiOperation({ summary: 'Get daily mint limits and today usage per token' })
  dailyLimits(@Param('chain') chain: string) {
    return this.svc.getDailyLimits(chain);
  }

  @Get('reserves')
  @ApiOperation({ summary: 'Get reserve entries from DB (custodian-added records)' })
  reserves() {
    return this.svc.getReserveStatus();
  }

  // ─── Requests — human review step before an on-chain propose() ─────────────

  @Post('requests')
  @ApiOperation({ summary: 'Submit a mint/burn request for review (any authenticated user — e.g. from the mobile app)' })
  createRequest(@Body() dto: CreateRequestDto, @Req() req: any) {
    return this.svc.createRequest(req.user.sub, dto);
  }

  @Get('requests/mine')
  @ApiOperation({ summary: "Get the caller's own treasury requests and their status" })
  myRequests(@Req() req: any) {
    return this.svc.getMyRequests(req.user.sub);
  }

  @Get('requests')
  @UseGuards(TreasuryTeamGuard)
  @ApiOperation({ summary: 'List treasury requests — treasury team / admin only' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING_REVIEW', 'PROPOSED', 'REJECTED'] })
  listRequests(@Query('status') status?: string) {
    return this.svc.getRequests(status);
  }

  @Get('requests/:id')
  @UseGuards(TreasuryTeamGuard)
  @ApiOperation({ summary: 'Get a single request, merged with live on-chain state once proposed — treasury team / admin only' })
  requestDetail(@Param('id') id: string) {
    return this.svc.getRequestDetail(id);
  }

  @Post('requests/:id/approve')
  @UseGuards(TreasuryTeamGuard)
  @ApiOperation({ summary: 'Approve a request — this is what actually calls the real on-chain propose(). Signer only.' })
  approveRequest(@Param('id') id: string, @Req() req: any) {
    return this.svc.approveRequest(id, req.user.sub);
  }

  @Post('requests/:id/reject')
  @UseGuards(TreasuryTeamGuard)
  @ApiOperation({ summary: 'Reject a request without ever touching the chain — treasury team / admin only' })
  rejectRequest(@Param('id') id: string, @Body() dto: RejectRequestDto, @Req() req: any) {
    return this.svc.rejectRequest(id, dto.reason, req.user.sub);
  }
}