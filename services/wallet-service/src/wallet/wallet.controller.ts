import {
  Controller, Get, Post, Body,
  Req, UseGuards, Query, ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard }     from '@nestjs/passport';
import { WalletService } from './wallet.service';
import { SendTokenDto }  from './dto/send-token.dto';
import { ImportWalletDto } from './dto/import-wallet.dto';

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create new wallet — returns mnemonic ONCE' })
  create(@Req() req: any) {
    return this.wallet.createWallet(req.user.sub);
  }

  @Post('import')
  @ApiOperation({ summary: 'Import wallet from existing seed phrase' })
  import(@Req() req: any, @Body() dto: ImportWalletDto) {
    return this.wallet.importWallet(req.user.sub, dto.mnemonic);
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Get all wallet addresses across all chains' })
  addresses(@Req() req: any) {
    return this.wallet.getAddresses(req.user.sub);
  }

  @Get('balances')
  @ApiOperation({ summary: 'Get token balances across all chains' })
  balances(@Req() req: any) {
    return this.wallet.getAllBalances(req.user.sub);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send tokens to another address' })
  send(@Req() req: any, @Body() dto: SendTokenDto) {
    return this.wallet.sendToken(req.user.sub, dto);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction history' })
  transactions(
    @Req() req: any,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.wallet.getTransactions(req.user.sub, page, limit);
  }
}