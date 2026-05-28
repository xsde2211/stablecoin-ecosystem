import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImportWalletDto {
  @ApiProperty({ example: 'word1 word2 word3 ... word24' })
  @IsString()
  @IsNotEmpty()
  mnemonic: string;
}