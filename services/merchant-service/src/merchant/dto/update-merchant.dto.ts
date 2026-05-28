import { IsString, IsOptional, IsUrl } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class UpdateMerchantDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() settlementAddress?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUrl() webhookUrl?: string;
}
