import { IsString, IsIn, IsNotEmpty, IsOptional, IsNumber, Min } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class CreatePaymentDto {
  @ApiProperty({ example: "999.00" }) @IsString() @IsNotEmpty() amount: string;
  @ApiProperty({ example: "INRX" }) @IsIn(["INRX", "EGOLD", "ESLVR"]) token: string;
  @ApiProperty({ example: "ORDER-12345" }) @IsString() @IsNotEmpty() reference: string;
  @ApiProperty({ required: false, example: 900 }) @IsOptional() @IsNumber() @Min(60) expiresIn?: number;
}
