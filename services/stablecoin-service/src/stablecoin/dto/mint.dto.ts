import { IsString, IsIn, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class MintDto {
  @ApiProperty({ example: "INRX" })
  @IsIn(["INRX", "EGOLD", "ESLVR"])
  token: string;

  @ApiProperty({ example: "ethereum" })
  @IsIn(["ethereum", "bsc", "polygon", "tron"])
  chain: string;

  @ApiProperty({ example: "0xRecipientAddress" })
  @IsString() @IsNotEmpty()
  toAddress: string;

  @ApiProperty({ example: "1000.000000" })
  @IsString() @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: "KYC approved mint" })
  @IsString() @IsNotEmpty()
  reason: string;
}
