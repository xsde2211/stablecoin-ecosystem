import { IsString, IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const CHAINS = ['sepolia', 'bsc', 'polygon', 'tron'];
const TOKENS = ['INRX', 'EGOLD', 'ESLVR'];

export class InitiateBridgeDto {
  @ApiProperty({ example: 'tron', enum: CHAINS })
  @IsIn(CHAINS)
  srcChain: string;

  @ApiProperty({ example: 'sepolia', enum: CHAINS })
  @IsIn(CHAINS)
  dstChain: string;

  @ApiProperty({ example: 'INRX', enum: TOKENS })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ example: '1000.000000', description: 'Amount as decimal string (6 decimals)' })
  @IsString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: '0xRecipientAddress', description: 'Recipient address on destination chain' })
  @IsString()
  @IsNotEmpty()
  dstAddress: string;
}

export class BurnBridgeDto {
  @ApiProperty({ example: 'sepolia', enum: CHAINS, description: 'Chain where you hold bridged tokens' })
  @IsIn(CHAINS)
  dstChain: string;  // chain where bridged tokens currently are

  @ApiProperty({ example: 'tron', enum: CHAINS, description: 'Chain to return tokens to' })
  @IsIn(CHAINS)
  srcChain: string;  // original source chain (where locked tokens sit)

  @ApiProperty({ example: 'INRX', enum: TOKENS })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ example: '500.000000' })
  @IsString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: '0xOriginalAddress', description: 'Address to receive unlocked tokens on source chain' })
  @IsString()
  @IsNotEmpty()
  srcRecipient: string;
}

export class ValidatorSignatureDto {
  @ApiProperty({ example: 'transfer-uuid-here' })
  @IsString()
  @IsNotEmpty()
  transferId: string;

  @ApiProperty({ example: '0xvalidatorsignature...' })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiProperty({ example: '0xValidatorAddress' })
  @IsString()
  @IsNotEmpty()
  validatorAddress: string;
}
