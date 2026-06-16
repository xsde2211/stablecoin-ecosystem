import { IsString, IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class ScoreDto {
  @ApiProperty() @IsString() @IsNotEmpty() userId: string;
  @ApiProperty({ enum:['SEND','RECEIVE','BRIDGE','PAYMENT'] }) @IsIn(['SEND','RECEIVE','BRIDGE','PAYMENT']) actionType: string;
  @ApiProperty({ example:'1000.00' }) @IsString() @IsNotEmpty() amount: string;
  @ApiProperty({ enum:['INRX','EGOLD','ESLVR'] }) @IsIn(['INRX','EGOLD','ESLVR']) token: string;
  @ApiProperty({ required:false }) @IsOptional() @IsString() toAddress?: string;
  @ApiProperty({ required:false }) @IsOptional() @IsString() chain?: string;
}
