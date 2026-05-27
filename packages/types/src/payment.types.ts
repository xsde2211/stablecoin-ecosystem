export type PaymentStatus =
  | 'PENDING'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface CreatePaymentDto {
  amount:     string;
  token:      string;
  reference:  string;
  expiresIn?: number;   // seconds, default 900 (15 min)
}

export interface PaymentRequest {
  id:         string;
  merchantId: string;
  amount:     string;
  token:      string;
  reference:  string;
  status:     PaymentStatus;
  expiresAt:  Date;
  paidAt?:    Date;
  txHash?:    string;
  qrData?:    string;
  deepLink?:  string;
}

export interface QrPaymentData {
  paymentId: string;
  amount:    string;
  token:     string;
  address:   string;
  deepLink:  string;
  expiresAt: string;
}