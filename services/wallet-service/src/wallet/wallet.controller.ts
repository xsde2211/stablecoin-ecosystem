import {
  Controller, Get, Post, Body, Req,
  UseGuards, Query, ParseIntPipe,
  DefaultValuePipe, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AuthGuard }      from '@nestjs/passport';
import { WalletService }  from './wallet.service';
import { SendTokenDto }   from './dto/send-token.dto';
import { ImportWalletDto} from './dto/import-wallet.dto';

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Post('create')
  @ApiOperation({
    summary:     'Create new HD wallet',
    description: 'Generates a BIP39 mnemonic and derives addresses for all 5 chains. Mnemonic shown ONCE — store it safely.',
  })
  create(@Req() req: any) {
    return this.wallet.createWallet(req.user.sub);
  }

  @Post('import')
  @ApiOperation({
    summary:     'Import wallet from seed phrase',
    description: 'Accepts 12 or 24 word BIP39 mnemonic. Derives addresses and stores encrypted.',
  })
  import(@Req() req: any, @Body() dto: ImportWalletDto) {
    return this.wallet.importWallet(req.user.sub, dto.mnemonic);
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Get wallet addresses for all chains (tron, ethereum, bsc, polygon, solana)' })
  addresses(@Req() req: any) {
    return this.wallet.getAddresses(req.user.sub);
  }

  @Get('balances')
  @ApiOperation({ summary: 'Get INRX, eGold, eSilver balances across all chains' })
  balances(@Req() req: any) {
    return this.wallet.getAllBalances(req.user.sub);
  }

  @Post('send')
  @ApiOperation({
    summary:     'Send tokens to another address',
    description: 'Sends INRX/EGOLD/ESLVR on specified chain. Transaction recorded as PENDING until confirmed by listener-service.',
  })
  send(@Req() req: any, @Body() dto: SendTokenDto) {
    return this.wallet.sendToken(req.user.sub, dto);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get paginated transaction history across all chains' })
  @ApiQuery({ name:'page',  required:false, type:Number })
  @ApiQuery({ name:'limit', required:false, type:Number })
  transactions(
    @Req() req: any,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.wallet.getTransactions(req.user.sub, page, limit);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get single transaction by ID' })
  transaction(@Req() req: any, @Param('id') id: string) {
    return this.wallet.getTransaction(req.user.sub, id);
  }
}
