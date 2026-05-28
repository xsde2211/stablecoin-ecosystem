import { IsString, IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendTokenDto {
  @ApiProperty({ example: 'tron' })
  @IsIn(['tron', 'ethereum', 'bsc', 'polygon', 'solana'])
  chain!: string;

  @ApiProperty({ example: 'TXyz...abc' })
  @IsString()
  @IsNotEmpty()
  toAddress!: string;

  @ApiProperty({ example: 'INRX' })
  @IsIn(['INRX', 'EGOLD', 'ESLVR'])
  token!: string;

  @ApiProperty({ example: '100.000000' })
  @IsString()
  @IsNotEmpty()
  amount!: string;
}