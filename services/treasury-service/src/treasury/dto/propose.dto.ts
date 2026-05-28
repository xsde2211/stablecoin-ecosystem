import { IsString, IsIn, IsNotEmpty, IsNumber, Min } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class ProposeDto {
  @ApiProperty({ example: "INRX" }) @IsIn(["INRX", "EGOLD", "ESLVR"]) token: string;
  @ApiProperty({ example: "ethereum" }) @IsIn(["ethereum", "bsc", "polygon", "tron"]) chain: string;
  @ApiProperty({ enum: ["MINT", "BURN"] }) @IsIn(["MINT", "BURN"]) opType: string;
  @ApiProperty({ example: "0xTargetAddress" }) @IsString() @IsNotEmpty() targetAddress: string;
  @ApiProperty({ example: "50000.000000" }) @IsString() @IsNotEmpty() amount: string;
  @ApiProperty({ example: "Approved by board" }) @IsString() @IsNotEmpty() reason: string;
}
