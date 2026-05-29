import {
  Controller, Post, Get, Body,
  Param, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard }       from '@nestjs/passport';
import { BridgeService }   from './bridge.service';
import { InitiateBridgeDto } from './dto/initiate-bridge.dto';

@ApiTags('Bridge')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('bridge')
export class BridgeController {
  constructor(private bridge: BridgeService) {}

  @Post('initiate')
  @ApiOperation({ summary: 'Start a cross-chain transfer' })
  initiate(@Req() req: any, @Body() dto: InitiateBridgeDto) {
    return this.bridge.initiate(req.user.sub, req.user.walletAddress, dto);
  }

  @Get('transfer/:id')
  @ApiOperation({ summary: 'Get bridge transfer status' })
  getTransfer(@Param('id') id: string) {
    return this.bridge.getTransfer(id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get user bridge transfer history' })
  history(@Req() req: any) {
    return this.bridge.getUserTransfers(req.user.sub);
  }
}