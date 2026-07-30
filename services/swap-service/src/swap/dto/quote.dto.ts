import { IsString, IsNotEmpty, IsNumberString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class QuoteDto {
  @ApiProperty({ enum: ['ethereum', 'bsc', 'polygon', 'tron', 'solana'], example: 'polygon' })
  @IsString() @IsNotEmpty()
  network: string;

  @ApiProperty({ enum: ['INRX', 'EGOLD', 'ESLVR'], example: 'INRX' })
  @IsString() @IsNotEmpty()
  fromToken: string;

  @ApiProperty({ enum: ['INRX', 'EGOLD', 'ESLVR'], example: 'EGOLD' })
  @IsString() @IsNotEmpty()
  toToken: string;

  @ApiProperty({ example: '100.00', description: 'Amount of fromToken to swap, as a decimal string' })
  @IsNumberString()
  amount: string;

  @ApiProperty({ example: 0, required: false })
  @IsOptional() @IsInt() @Min(0)
  walletIndex?: number;
}
