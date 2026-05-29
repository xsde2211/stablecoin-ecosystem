import { IsIn } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class UpdateUserRoleDto {
  @ApiProperty({ enum: ["USER","MERCHANT","ADMIN"] })
  @IsIn(["USER","MERCHANT","ADMIN"]) role: string;
}
