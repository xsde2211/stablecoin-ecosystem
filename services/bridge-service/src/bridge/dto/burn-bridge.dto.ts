import { IsString, IsIn, IsNotEmpty, IsNumberString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BurnBridgeDto {
  @ApiProperty({ enum: ['tron','ethereum','bsc','polygon'], example: 'tron' })
  @IsIn(['tron','ethereum','bsc','polygon'])
  chain: string;

  @ApiProperty({ enum: ['INRX','EGOLD','ESLVR'] })
  @IsIn(['INRX','EGOLD','ESLVR'])
  token: string;

  @ApiProperty({ example: '100.5' })
  @IsNumberString()
  amount: string;

  @ApiProperty({ example: 'ethereum', description: 'Chain where tokens should be unlocked' })
  @IsIn(['tron','ethereum','bsc','polygon'])
  srcChain: string;

  @ApiProperty({ example: '0xYourEVMAddress' })
  @IsString()
  @IsNotEmpty()
  srcRecipient: string;
}
