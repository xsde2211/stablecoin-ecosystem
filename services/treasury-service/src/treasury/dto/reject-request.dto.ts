import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectRequestDto {
  @ApiProperty({ example: 'Amount exceeds daily limit' })
  @IsString() @IsNotEmpty()
  reason!: string;
}