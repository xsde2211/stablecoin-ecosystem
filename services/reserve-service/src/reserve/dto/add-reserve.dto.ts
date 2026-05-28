import { IsString, IsIn, IsNotEmpty, IsOptional, IsUrl } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class AddReserveDto {
  @ApiProperty({ example: "INRX" }) @IsIn(["INRX", "EGOLD", "ESLVR"]) token: string;
  @ApiProperty({ example: "INR_BANK" }) @IsIn(["INR_BANK", "GOLD_VAULT", "SILVER_VAULT", "T_BILL"]) assetType: string;
  @ApiProperty({ example: "10000000.00" }) @IsString() @IsNotEmpty() amount: string;
  @ApiProperty({ example: "HDFC Bank" }) @IsString() @IsNotEmpty() custodian: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() proofUrl?: string;
}
