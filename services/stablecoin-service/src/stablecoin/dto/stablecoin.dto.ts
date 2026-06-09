import { IsString, IsIn, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const CHAINS = ['sepolia', 'bsc', 'polygon', 'tron'];
const TOKENS = ['INRX', 'EGOLD', 'ESLVR'];

export class MintDto {
  @ApiProperty({ example: 'INRX', enum: TOKENS })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ example: 'sepolia', enum: CHAINS })
  @IsIn(CHAINS)
  chain: string;

  @ApiProperty({ example: '0xRecipientAddress' })
  @IsString() @IsNotEmpty()
  toAddress: string;

  @ApiProperty({ example: '1000.000000', description: 'Amount as decimal string (6 decimals)' })
  @IsString() @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: 'Reserve deposit KYC-approved' })
  @IsString() @IsNotEmpty()
  reason: string;
}

export class BurnDto {
  @ApiProperty({ example: 'INRX', enum: TOKENS })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ example: 'sepolia', enum: CHAINS })
  @IsIn(CHAINS)
  chain: string;

  @ApiProperty({ example: '0xFromAddress' })
  @IsString() @IsNotEmpty()
  fromAddress: string;

  @ApiProperty({ example: '500.000000' })
  @IsString() @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: 'Redemption' })
  @IsString() @IsNotEmpty()
  reason: string;
}

export class TreasuryProposeDto {
  @ApiProperty({ example: 'INRX', enum: TOKENS })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ example: 'sepolia', enum: CHAINS })
  @IsIn(CHAINS)
  chain: string;

  @ApiProperty({ example: 'MINT', enum: ['MINT', 'BURN', 'PAUSE', 'UNPAUSE'] })
  @IsIn(['MINT', 'BURN', 'PAUSE', 'UNPAUSE'])
  opType: string;

  @ApiProperty({ example: '0xTargetAddress' })
  @IsString() @IsNotEmpty()
  target: string;

  @ApiPropertyOptional({ example: '10000.000000' })
  @IsOptional() @IsString()
  amount?: string;

  @ApiProperty({ example: 'Monthly reserve mint' })
  @IsString() @IsNotEmpty()
  reason: string;
}

export class TreasurySignDto {
  @ApiProperty({ example: 'sepolia', enum: CHAINS })
  @IsIn(CHAINS)
  chain: string;

  @ApiProperty({ example: 'INRX', enum: TOKENS })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ example: 42, description: 'Operation ID from propose' })
  @IsNumber() @Min(0)
  opId: number;
}

export class TreasuryExecuteDto {
  @ApiProperty({ example: 'sepolia', enum: CHAINS })
  @IsIn(CHAINS)
  chain: string;

  @ApiProperty({ example: 'INRX', enum: TOKENS })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ example: 42 })
  @IsNumber() @Min(0)
  opId: number;
}

export class ComplianceActionDto {
  @ApiProperty({ example: 'INRX', enum: TOKENS })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ example: 'sepolia', enum: CHAINS })
  @IsIn(CHAINS)
  chain: string;

  @ApiProperty({ example: '0xTargetAddress' })
  @IsString() @IsNotEmpty()
  address: string;

  @ApiProperty({ example: true })
  status: boolean;
}
