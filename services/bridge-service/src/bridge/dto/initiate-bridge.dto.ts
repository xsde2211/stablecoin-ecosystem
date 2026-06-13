import { IsString, IsIn, IsNotEmpty, IsNumberString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const CHAINS = ['tron','ethereum','bsc','polygon'] as const;
const TOKENS = ['INRX','EGOLD','ESLVR'] as const;

export class InitiateBridgeDto {
  @ApiProperty({ enum: CHAINS, example: 'tron' })
  @IsIn(CHAINS)
  srcChain: string;

  @ApiProperty({ enum: CHAINS, example: 'ethereum' })
  @IsIn(CHAINS)
  dstChain: string;

  @ApiProperty({ enum: TOKENS, example: 'INRX' })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ example: '100.5' })
  @IsNumberString()
  amount: string;

  @ApiProperty({ example: '0xRecipientAddress', description: 'Recipient address on destination chain' })
  @IsString()
  @IsNotEmpty()
  dstAddress: string;
}
