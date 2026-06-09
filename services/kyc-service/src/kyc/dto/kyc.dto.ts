import {
  IsString, IsIn, IsNotEmpty, IsOptional,
  IsEmail, IsEnum, IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum KycProvider {
  HYPERVERGE  = 'hyperverge',
  DIGILOCKER  = 'digilocker',
  ONFIDO      = 'onfido',
}

export enum KycDocType {
  AADHAAR          = 'AADHAAR',
  PAN              = 'PAN',
  PASSPORT         = 'PASSPORT',
  DRIVING_LICENSE  = 'DRIVING_LICENSE',
  VOTER_ID         = 'VOTER_ID',
}

export class SubmitKycDto {
  @ApiProperty({ example: 'hyperverge', enum: KycProvider })
  @IsEnum(KycProvider)
  provider: KycProvider;

  @ApiProperty({ example: 'AADHAAR', enum: KycDocType })
  @IsEnum(KycDocType)
  documentType: KycDocType;

  @ApiProperty({ example: 'HV-REF-12345', description: 'Reference ID returned by the KYC provider after doc upload' })
  @IsString() @IsNotEmpty()
  documentRef: string;

  @ApiPropertyOptional({ example: 'https://ipfs.io/ipfs/Qm...', description: 'Optional self-hosted document URL' })
  @IsOptional() @IsString()
  documentUrl?: string;
}

export class KycWebhookDto {
  @ApiProperty({ example: 'HV-REF-12345' })
  @IsString() @IsNotEmpty()
  referenceId: string;

  @ApiProperty({ example: 'approved', enum: ['approved', 'rejected', 'needs_review'] })
  @IsIn(['approved', 'rejected', 'needs_review'])
  status: string;

  @ApiPropertyOptional({ example: 'Document expired' })
  @IsOptional() @IsString()
  rejectionReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  providerData?: Record<string, any>;
}

export class AdminReviewDto {
  @ApiProperty({ example: 'Document image is blurry' })
  @IsString() @IsNotEmpty()
  reason: string;
}

export class KycListQueryDto {
  @ApiPropertyOptional({ example: 1 })
  page?: number;

  @ApiPropertyOptional({ example: 50 })
  limit?: number;

  @ApiPropertyOptional({ example: 'SUBMITTED', enum: ['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'] })
  status?: string;

  @ApiPropertyOptional({ example: 'hyperverge', enum: KycProvider })
  provider?: string;
}
