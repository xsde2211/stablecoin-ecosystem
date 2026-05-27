export type KycProvider = 'hyperverge' | 'digilocker' | 'onfido';
export type DocumentType = 'AADHAAR' | 'PAN' | 'PASSPORT' | 'DRIVING_LICENSE';

export interface KycSubmitDto {
  provider:     KycProvider;
  documentType: DocumentType;
  documentRef:  string;   // provider's reference ID after upload
}

export interface KycApplication {
  id:              string;
  userId:          string;
  provider:        KycProvider;
  status:          string;
  documentType?:   DocumentType;
  verifiedAt?:     Date;
  rejectedReason?: string;
  createdAt:       Date;
}