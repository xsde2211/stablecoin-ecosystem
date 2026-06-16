import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class UpdateRoleDto {
  // dto/update-role.dto.ts
  @ApiProperty({ enum:['USER','MERCHANT','COMPLIANCE','ADMIN','SUPER_ADMIN'], example:'MERCHANT' })
  @IsIn(['USER','MERCHANT','COMPLIANCE','ADMIN','SUPER_ADMIN'])
  role: string;
}
