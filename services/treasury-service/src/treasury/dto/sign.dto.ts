import { IsString, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignDto {
  @ApiProperty({ enum: ['ethereum','bsc','polygon'], example: 'ethereum' })
  @IsIn(['ethereum','bsc','polygon'])
  chain: string;

  @ApiProperty({ example: '0', description: 'Operation ID returned by propose endpoint' })
  @IsString()
  @IsNotEmpty()
  opId: string;
}
