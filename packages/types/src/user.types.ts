export type UserRole = 'USER' | 'MERCHANT' | 'ADMIN' | 'SUPER_ADMIN';
export type KycStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface User {
  id:          string;
  email:       string;
  phone?:      string;
  role:        UserRole;
  kycStatus:   KycStatus;
  riskScore:   number;
  isActive:    boolean;
  createdAt:   Date;
}

export interface JwtPayload {
  sub:   string;   // userId
  email: string;
  role:  UserRole;
  iat:   number;
  exp:   number;
}

export interface RegisterDto {
  email:    string;
  phone?:   string;
  password: string;
  fullName: string;
}

export interface LoginDto {
  email:     string;
  password:  string;
  totpCode?: string;  // 2FA code
}

export interface AuthTokens {
  accessToken:  string;
  refreshToken: string;
}