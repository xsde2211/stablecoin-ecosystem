import { IsString, IsIn, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class ResolveFlagDto {
  @ApiProperty({ enum:['CONFIRMED_FRAUD','FALSE_POSITIVE','RESOLVED'] }) @IsIn(['CONFIRMED_FRAUD','FALSE_POSITIVE','RESOLVED']) resolution: string;
  @ApiProperty({ example:'Reviewed — legitimate transaction, user verified via call' }) @IsString() @IsNotEmpty() notes: string;
}
