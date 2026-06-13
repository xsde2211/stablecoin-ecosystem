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

@ApiTags('Treasury')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('treasury')
export class TreasuryController {
  constructor(private svc: TreasuryService) {}

  @Post('propose')
  @ApiOperation({
    summary:     'Propose a mint/burn/pause operation',
    description: 'Creates an operation on-chain. Proposer auto-signs. Collect 2-of-3 signatures to queue for execution after 12h timelock.',
  })
  propose(@Body() dto: ProposeDto, @Req() req: any) {
    return this.svc.propose(dto, req.user.sub);
  }

  @Post('sign')
  @ApiOperation({
    summary:     'Sign a pending treasury operation',
    description: 'Adds your signature. When threshold reached, 12-hour timelock begins.',
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
    description: 'Anyone can call this after the 12-hour window passes.',
  })
  execute(@Param('chain') chain: string, @Param('opId') opId: string, @Req() req: any) {
    return this.svc.execute(chain, opId, req.user.sub);
  }

  @Post('cancel/:chain/:opId')
  @ApiOperation({
    summary:     'Cancel a pending/queued operation (guardian only)',
    description: 'Guardian can cancel at any time before execution. This is the emergency stop.',
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
}
