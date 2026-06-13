import { IsString, IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const CHAINS = ['ethereum','bsc','polygon'] as const;
const TOKENS = ['INRX','EGOLD','ESLVR'] as const;
const OPS    = ['MINT','BURN','PAUSE','UNPAUSE'] as const;

export class ProposeDto {
  @ApiProperty({ enum: CHAINS, example: 'ethereum' })
  @IsIn(CHAINS)
  chain: string;

  @ApiProperty({ enum: TOKENS, example: 'INRX' })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ enum: OPS, example: 'MINT' })
  @IsIn(OPS)
  opType: string;

  @ApiProperty({ example: '0xRecipientAddress', description: 'Target wallet for mint/burn' })
  @IsOptional()
  @IsString()
  targetAddress?: string;

  @ApiProperty({ example: '1000000.00', description: 'Amount with 6 decimals (required for MINT/BURN)' })
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiProperty({ example: 'KYC approved batch mint' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
