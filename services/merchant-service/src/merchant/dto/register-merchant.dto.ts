import { IsString, IsNotEmpty, IsIn, IsOptional, IsUrl } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class RegisterMerchantDto {
  @ApiProperty({ example: "Chai Store" }) @IsString() @IsNotEmpty() name: string;
  @ApiProperty({ example: "TXyz...abc" }) @IsString() @IsNotEmpty() settlementAddress: string;
  @ApiProperty({ example: "tron" }) @IsIn(["tron", "ethereum", "bsc", "polygon"]) settlementChain: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUrl() webhookUrl?: string;
}
