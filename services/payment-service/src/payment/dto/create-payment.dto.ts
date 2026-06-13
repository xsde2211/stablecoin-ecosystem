import { IsString, IsIn, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
export class CreatePaymentDto {
  @ApiProperty({ example:'1500.00' }) @IsString() @IsNotEmpty() amount: string;
  @ApiProperty({ enum:['INRX','EGOLD','ESLVR'] }) @IsIn(['INRX','EGOLD','ESLVR']) token: string;
  @ApiProperty({ required:false }) @IsOptional() @IsString() reference?: string;
  @ApiProperty({ required:false, example:900 }) @IsOptional() @Type(()=>Number) @IsNumber() @Min(60) @Max(86400) expiresIn?: number;
  @ApiProperty({ required:false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required:false }) @IsOptional() @IsString() webhookUrl?: string;
}
