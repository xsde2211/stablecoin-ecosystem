import { IsString, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class BurnDto {
  @ApiProperty({ enum:['INRX','EGOLD','ESLVR'] }) @IsIn(['INRX','EGOLD','ESLVR']) token: string;
  @ApiProperty({ enum:['ethereum','bsc','polygon'] }) @IsIn(['ethereum','bsc','polygon']) chain: string;
  @ApiProperty() @IsString() @IsNotEmpty() fromAddress: string;
  @ApiProperty({ example:'500.00' }) @IsString() @IsNotEmpty() amount: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason: string;
}
