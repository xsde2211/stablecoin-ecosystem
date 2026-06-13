import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class DeactivateReserveDto {
  @ApiProperty({ example:'Funds moved to new account' }) @IsString() @IsNotEmpty() reason: string;
}
