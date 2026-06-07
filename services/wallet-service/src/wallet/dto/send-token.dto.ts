import { IsString, IsIn, IsNumberString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const CHAINS = ['tron','ethereum','bsc','polygon'] as const;
const TOKENS = ['INRX','EGOLD','ESLVR'] as const;

export class SendTokenDto {
  @ApiProperty({ enum: TOKENS, example: 'INRX' })
  @IsIn(TOKENS)
  token: string;

  @ApiProperty({ enum: CHAINS, example: 'tron' })
  @IsIn(CHAINS)
  chain: string;

  @ApiProperty({ example: 'TYour...TronAddress' })
  @IsString()
  @IsNotEmpty()
  toAddress: string;

  @ApiProperty({ example: '10.5', description: 'Amount as decimal string' })
  @IsNumberString()
  amount: string;
}
