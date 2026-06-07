import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty }          from '@nestjs/swagger';

export class ImportWalletDto {
  @ApiProperty({ example: 'word1 word2 ... word24', description: '12 or 24 word BIP39 mnemonic' })
  @IsString()
  @IsNotEmpty()
  mnemonic: string;
}
