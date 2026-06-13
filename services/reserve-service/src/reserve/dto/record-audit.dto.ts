import { IsString, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class RecordAuditDto {
  @ApiProperty({ enum:['INRX','EGOLD','ESLVR'] }) @IsIn(['INRX','EGOLD','ESLVR']) token: string;
  @ApiProperty({ enum:['ethereum','bsc','polygon'] }) @IsIn(['ethereum','bsc','polygon']) chain: string;
  @ApiProperty({ example:'10500000.00' }) @IsString() @IsNotEmpty() reserveAmount: string;
  @ApiProperty({ example:'10000000.00' }) @IsString() @IsNotEmpty() circulatingSupply: string;
  @ApiProperty({ example:'Deloitte India LLP' }) @IsString() @IsNotEmpty() auditorName: string;
  @ApiProperty({ example:'QmAuditReport456...' }) @IsString() @IsNotEmpty() reportHash: string;
  @ApiProperty({ example:'Q2 2025 annual audit' }) @IsString() @IsNotEmpty() notes: string;
}
