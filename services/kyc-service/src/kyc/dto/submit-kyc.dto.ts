import { IsString, IsIn, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class SubmitKycDto {
  @ApiProperty({ example: "hyperverge" }) @IsIn(["hyperverge", "digilocker", "onfido"]) provider: string;
  @ApiProperty({ example: "AADHAAR" }) @IsIn(["AADHAAR", "PAN", "PASSPORT", "DRIVING_LICENSE"]) documentType: string;
  @ApiProperty({ example: "HV-REF-12345" }) @IsString() @IsNotEmpty() documentRef: string;
}
