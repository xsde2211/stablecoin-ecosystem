import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExecuteSwapDto {
  @ApiProperty({ description: 'quoteId returned from POST /swap/quote' })
  @IsString() @IsNotEmpty()
  quoteId: string;
}
