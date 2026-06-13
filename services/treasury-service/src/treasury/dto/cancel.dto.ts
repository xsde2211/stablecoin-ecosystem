import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelDto {
  @ApiProperty({ example: 'Suspicious activity detected' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
