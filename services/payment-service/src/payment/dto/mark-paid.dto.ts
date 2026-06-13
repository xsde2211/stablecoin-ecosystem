import { IsString, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class MarkPaidDto {
  @ApiProperty({ example:'0xabc123...' }) @IsString() @IsNotEmpty() txHash: string;
  @ApiProperty({ enum:['tron','ethereum','bsc','polygon'] }) @IsIn(['tron','ethereum','bsc','polygon']) chain: string;
}
