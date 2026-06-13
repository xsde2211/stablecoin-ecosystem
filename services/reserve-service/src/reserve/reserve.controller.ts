import {
  Controller, Get, Post, Body, Param, Req,
  UseGuards, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard }     from '@nestjs/passport';
import { ReserveService } from './reserve.service';
import { AddReserveDto }  from './dto/add-reserve.dto';
import { RecordAuditDto } from './dto/record-audit.dto';
import { DeactivateReserveDto } from './dto/deactivate-reserve.dto';

@ApiTags('Reserve')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('reserve')
export class ReserveController {
  constructor(private svc: ReserveService) {}

  @Post('entry')
  @ApiOperation({ summary:'Add reserve entry on-chain + DB (custodian role)' })
  addEntry(@Body() dto: AddReserveDto, @Req() req: any) { return this.svc.addEntry(dto, req.user.sub); }

  @Post('deactivate/:chain/:entryId')
  @ApiOperation({ summary:'Deactivate reserve entry (funds moved)' })
  deactivate(@Param('chain') chain:string, @Param('entryId', ParseIntPipe) id:number, @Body() dto:DeactivateReserveDto, @Req() req:any) {
    return this.svc.deactivateEntry(chain, id, dto.reason, req.user.sub);
  }

  @Post('audit')
  @ApiOperation({ summary:'Record audit result on-chain (auditor role)' })
  recordAudit(@Body() dto: RecordAuditDto, @Req() req: any) { return this.svc.recordAudit(dto, req.user.sub); }

  @Get('proof/:token/:chain')
  @ApiOperation({ summary:'Proof of reserve from on-chain (cached 5min)' })
  proofOnChain(@Param('token') token:string, @Param('chain') chain:string) { return this.svc.getProofOfReserve(token, chain); }

  @Get('proof/:token')
  @ApiOperation({ summary:'Proof of reserve across all chains' })
  proofAllChains(@Param('token') token:string) { return this.svc.getProofAllChains(token); }

  @Get('db-proof/:token')
  @ApiOperation({ summary:'Proof of reserve from DB (fast, no RPC)' })
  proofDB(@Param('token') token:string) { return this.svc.getDBProof(token); }

  @Get('entries/:token/:chain')
  @ApiOperation({ summary:'Get all active reserve entries on-chain' })
  entries(@Param('token') token:string, @Param('chain') chain:string) { return this.svc.getActiveReserves(token, chain); }

  @Get('audits/:token/:chain')
  @ApiOperation({ summary:'Get full audit history from on-chain' })
  audits(@Param('token') token:string, @Param('chain') chain:string) { return this.svc.getAuditHistory(token, chain); }

  @Get('health')
  @ApiOperation({ summary:'Collateralization health across all tokens and chains' })
  health() { return this.svc.getHealthStatus(); }
}
