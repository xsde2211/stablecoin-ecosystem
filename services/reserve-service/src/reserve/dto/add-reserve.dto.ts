import { IsString, IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class AddReserveDto {
  @ApiProperty({ enum:['INRX','EGOLD','ESLVR'] }) @IsIn(['INRX','EGOLD','ESLVR']) token: string;
  @ApiProperty({ enum:['INR_BANK_DEPOSIT','GOLD_VAULT','SILVER_VAULT','GOVT_SECURITIES','USDT_COLLATERAL'] })
  @IsIn(['INR_BANK_DEPOSIT','GOLD_VAULT','SILVER_VAULT','GOVT_SECURITIES','USDT_COLLATERAL']) assetType: string;
  @ApiProperty({ example:'10000000.00' }) @IsString() @IsNotEmpty() amount: string;
  @ApiProperty({ example:'HDFC Bank Mumbai' }) @IsString() @IsNotEmpty() custodian: string;
  @ApiProperty({ required:false, example:'QmXyz...' }) @IsOptional() @IsString() proofHash?: string;
  @ApiProperty({ required:false }) @IsOptional() @IsString() proofUrl?: string;
  @ApiProperty({ enum:['ethereum','bsc','polygon'] }) @IsIn(['ethereum','bsc','polygon']) chain: string;
}
