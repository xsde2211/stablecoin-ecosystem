import { IsString, IsIn, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class UpdateMerchantDto {
  @ApiProperty({ required:false }) @IsOptional() @IsString() businessName?: string;
  @ApiProperty({ required:false }) @IsOptional() @IsEmail() businessEmail?: string;
  @ApiProperty({ required:false }) @IsOptional() @IsString() gstin?: string;
  @ApiProperty({ required:false, enum:['ethereum','bsc','polygon','tron'] })
  @IsOptional() @IsIn(['ethereum','bsc','polygon','tron']) settlementChain?: string;
  @ApiProperty({ required:false }) @IsOptional() @IsString() settlementAddress?: string;
}
