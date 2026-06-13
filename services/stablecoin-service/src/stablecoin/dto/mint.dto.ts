import { IsString, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class MintDto {
  @ApiProperty({ enum:['INRX','EGOLD','ESLVR'] }) @IsIn(['INRX','EGOLD','ESLVR']) token: string;
  @ApiProperty({ enum:['ethereum','bsc','polygon'] }) @IsIn(['ethereum','bsc','polygon']) chain: string;
  @ApiProperty() @IsString() @IsNotEmpty() toAddress: string;
  @ApiProperty({ example:'1000.00' }) @IsString() @IsNotEmpty() amount: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason: string;
}
