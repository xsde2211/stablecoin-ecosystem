import { IsString, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class MarkPaidDto {
  @ApiProperty({ example: "0xabcdef..." }) @IsString() @IsNotEmpty() txHash: string;
}
