import { IsEmail, IsString, IsOptional, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  password: string;

  @ApiProperty({ required: false, example: '123456', description: 'Required if 2FA is enabled' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  totpCode?: string;
}
