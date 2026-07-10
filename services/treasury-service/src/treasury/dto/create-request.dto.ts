import { IsString, IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const CHAINS = ['ethereum', 'bsc', 'polygon'] as const;
const TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;
const OPS    = ['MINT', 'BURN'] as const;

export class CreateRequestDto {
  @ApiProperty({ enum: CHAINS, example: 'ethereum' })
  @IsIn(CHAINS)
  chain!: string;

  @ApiProperty({ enum: TOKENS, example: 'INRX' })
  @IsIn(TOKENS)
  token!: string;

  @ApiProperty({ enum: OPS, example: 'MINT' })
  @IsIn(OPS)
  opType!: string;

  @ApiProperty({ example: '50.00' })
  @IsString() @IsNotEmpty()
  amount!: string;

  @ApiProperty({ example: 'Need 50 INRX for a testnet purchase demo' })
  @IsString() @IsNotEmpty()
  reason!: string;

  @ApiProperty({ required: false, description: 'Defaults to your own wallet on that chain if omitted' })
  @IsOptional() @IsString()
  targetAddress?: string;
}