import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty }          from '@nestjs/swagger';
export class RejectKycDto {
  @ApiProperty({ example:'Document image unclear or expired' })
  @IsString() @IsNotEmpty() reason: string;
}
