import { IsString, IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class SubmitKycDto {
  @ApiProperty({ enum:['manual','hyperverge','digilocker','aadhaar_xml'], example:'manual' })
  @IsIn(['manual','hyperverge','digilocker','aadhaar_xml'])
  provider: string;

  @ApiProperty({ enum:['AADHAAR','PAN','PASSPORT','DRIVING_LICENSE','VOTER_ID'], example:'AADHAAR' })
  @IsIn(['AADHAAR','PAN','PASSPORT','DRIVING_LICENSE','VOTER_ID'])
  documentType: string;

  @ApiProperty({ example:'DEMO-1234567890' })
  @IsString() @IsNotEmpty()
  documentRef: string;

  @ApiProperty({ required:false, example:'Rahul Sharma' })
  @IsOptional() @IsString() fullName?: string;

  @ApiProperty({ required:false, example:'1995-06-15' })
  @IsOptional() @IsString() dateOfBirth?: string;

  @ApiProperty({ required:false })
  @IsOptional() @IsString() address?: string;
}
