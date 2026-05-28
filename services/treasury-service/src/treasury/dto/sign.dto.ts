import { IsString, IsNotEmpty, IsIn } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class SignDto {
  @ApiProperty({ example: "ethereum" }) @IsIn(["ethereum", "bsc", "polygon", "tron"]) chain: string;
  @ApiProperty({ example: "42" }) @IsString() @IsNotEmpty() opId: string;
}
