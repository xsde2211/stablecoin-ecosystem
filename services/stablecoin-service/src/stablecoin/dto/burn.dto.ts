import { IsString, IsIn, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class BurnDto {
  @ApiProperty({ example: "INRX" })
  @IsIn(["INRX", "EGOLD", "ESLVR"])
  token: string;

  @ApiProperty({ example: "ethereum" })
  @IsIn(["ethereum", "bsc", "polygon", "tron"])
  chain: string;

  @ApiProperty({ example: "0xFromAddress" })
  @IsString() @IsNotEmpty()
  fromAddress: string;

  @ApiProperty({ example: "500.000000" })
  @IsString() @IsNotEmpty()
  amount: string;

  @ApiProperty({ example: "Redemption burn" })
  @IsString() @IsNotEmpty()
  reason: string;
}
