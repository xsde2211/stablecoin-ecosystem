import { IsString, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class BlacklistDto {
  @ApiProperty({ example:'0xAddress or TAddress' }) @IsString() @IsNotEmpty() address: string;
  @ApiProperty({ enum:['ethereum','bsc','polygon','tron'] }) @IsIn(['ethereum','bsc','polygon','tron']) chain: string;
  @ApiProperty({ example:'Reported for scam activity' }) @IsString() @IsNotEmpty() reason: string;
}
