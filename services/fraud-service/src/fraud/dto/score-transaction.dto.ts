import { IsString, IsNumber, IsIn, IsNotEmpty, Min } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class ScoreTransactionDto {
  @ApiProperty() @IsString() @IsNotEmpty() userId: string;
  @ApiProperty() @IsString() @IsNotEmpty() transactionId: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiProperty() @IsString() @IsNotEmpty() toAddress: string;
  @ApiProperty() @IsString() @IsNotEmpty() fromAddress: string;
  @ApiProperty() @IsIn(["tron","ethereum","bsc","polygon","solana"]) chain: string;
  @ApiProperty() @IsIn(["INRX","EGOLD","ESLVR"]) token: string;
}
