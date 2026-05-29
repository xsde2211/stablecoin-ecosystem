import { IsString, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const CHAINS = ['tron', 'ethereum', 'bsc', 'polygon', 'solana'];

export class InitiateBridgeDto {
  @ApiProperty({ example: 'tron' })
  @IsIn(CHAINS)
  srcChain: string;

  @ApiProperty({ example: 'ethereum' })
  @IsIn(CHAINS)
  dstChain: string;

  @ApiProperty({ example: 'INRX' })
  @IsIn(['INRX', 'EGOLD', 'ESLVR'])
  token: string;

  @ApiProperty({ example: '1000.000000' })
  @IsString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: '0xRecipientAddress' })
  @IsString()
  @IsNotEmpty()
  dstAddress: string;
}