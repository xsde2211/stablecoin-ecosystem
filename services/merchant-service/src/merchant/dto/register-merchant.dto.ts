import { IsString, IsIn, IsNotEmpty, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class RegisterMerchantDto {
  @ApiProperty({ example:'Rahul Electronics Pvt Ltd' }) @IsString() @IsNotEmpty() businessName: string;
  @ApiProperty({ example:'support@rahulelectronics.com', required:false }) @IsOptional() @IsEmail() businessEmail?: string;
  @ApiProperty({ example:'27AAAAA0000A1Z5', required:false, description:'GSTIN if registered' })
  @IsOptional() @IsString() gstin?: string;
  @ApiProperty({ enum:['ethereum','bsc','polygon','tron'], example:'tron' })
  @IsIn(['ethereum','bsc','polygon','tron']) settlementChain: string;
  @ApiProperty({ example:'TYourSettlementAddress...' }) @IsString() @IsNotEmpty() settlementAddress: string;
}
