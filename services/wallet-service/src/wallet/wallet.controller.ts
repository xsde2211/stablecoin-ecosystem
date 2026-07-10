import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  Req, UseGuards, Query, ParseIntPipe,
  DefaultValuePipe, Optional,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsInt, IsString, IsNotEmpty, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AuthGuard }     from '@nestjs/passport';
import { WalletService } from './wallet.service';
import { SendTokenDto }  from './dto/send-token.dto';
import { ImportWalletDto } from './dto/import-wallet.dto';

class CreateWalletDto {
  @ApiProperty({ example: 'Trading Wallet', required: false })
  @IsString()
  @IsOptional()
  label?: string;
}

class RenameWalletDto {
  @ApiProperty({ example: 0 })
  @IsInt() @Min(0)
  walletIndex!: number;

  @ApiProperty({ example: 'My Main Wallet' })
  @IsString() @IsNotEmpty()
  label!: string;
}

class SendTokenWithIndexDto extends SendTokenDto {
  @ApiProperty({ example: 0, required: false, description: 'Which wallet to send from (default: 0)' })
  @IsInt() @Min(0) @IsOptional()
  walletIndex?: number;
}

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a new wallet — returns mnemonic ONCE. Supports multiple wallets per user.' })
  create(@Req() req: any, @Body() dto: CreateWalletDto) {
    return this.wallet.createWallet(req.user.sub, dto.label);
  }

  @Post('import')
  @ApiOperation({ summary: 'Import wallet from existing 12/24-word seed phrase' })
  import(@Req() req: any, @Body() dto: ImportWalletDto) {
    return this.wallet.importWallet(req.user.sub, dto.mnemonic);
  }

  @Get('list')
  @ApiOperation({ summary: 'Get all wallets with their addresses grouped by walletIndex' })
  list(@Req() req: any) {
    return this.wallet.getWallets(req.user.sub);
  }

  @Patch('rename')
  @ApiOperation({ summary: 'Rename a wallet by walletIndex' })
  rename(@Req() req: any, @Body() dto: RenameWalletDto) {
    return this.wallet.renameWallet(req.user.sub, dto.walletIndex, dto.label);
  }

  // ── Delete a wallet (soft delete — refuses to delete your last wallet) ──────
  @Delete(':walletIndex')
  @ApiOperation({ summary: 'Delete a wallet by walletIndex. Refuses to delete your only remaining wallet.' })
  remove(@Req() req: any, @Param('walletIndex', ParseIntPipe) walletIndex: number) {
    return this.wallet.deleteWallet(req.user.sub, walletIndex);
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Get all wallet addresses across all chains for a given walletIndex (default: 0)' })
  @ApiQuery({ name: 'walletIndex', required: false, type: Number })
  addresses(
    @Req() req: any,
    @Query('walletIndex', new DefaultValuePipe(0), ParseIntPipe) walletIndex: number,
  ) {
    return this.wallet.getAddresses(req.user.sub, walletIndex);
  }

  @Get('balances')
  @ApiOperation({ summary: 'Get token balances for a given walletIndex (default: 0)' })
  @ApiQuery({ name: 'walletIndex', required: false, type: Number })
  balances(
    @Req() req: any,
    @Query('walletIndex', new DefaultValuePipe(0), ParseIntPipe) walletIndex: number,
  ) {
    return this.wallet.getAllBalances(req.user.sub, walletIndex);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send tokens from a specific wallet (walletIndex in body, default: 0)' })
  send(@Req() req: any, @Body() dto: SendTokenWithIndexDto) {
    return this.wallet.sendToken(req.user.sub, dto);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction history. Pass walletIndex to filter by wallet (omit for all wallets).' })
  @ApiQuery({ name: 'page',        required: false, type: Number })
  @ApiQuery({ name: 'limit',       required: false, type: Number })
  @ApiQuery({ name: 'walletIndex', required: false, type: Number, description: 'Filter by wallet index. Omit to get all wallets.' })
  transactions(
    @Req() req: any,
    @Query('page',  new DefaultValuePipe(1),         ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20),        ParseIntPipe) limit: number,
    @Query('walletIndex') walletIndex?: string,
  ) {
    const idx = walletIndex !== undefined ? parseInt(walletIndex, 10) : undefined;
    return this.wallet.getTransactions(req.user.sub, page, limit, idx);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get a single transaction by ID' })
  getTransaction(@Req() req: any, @Param('id') id: string) {
    return this.wallet.getTransaction(req.user.sub, id);
  }
}
