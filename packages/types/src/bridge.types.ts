import { Chain } from './wallet.types';

export type BridgeStatus =
  | 'PENDING'
  | 'LOCKED'
  | 'SIGNATURES_COLLECTED'
  | 'MINTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED';

export interface BridgeTransferDto {
  srcChain:   Chain;
  dstChain:   Chain;
  token:      string;   // 'INRX' | 'EGOLD' | 'ESLVR'
  amount:     string;
  dstAddress: string;
}

export interface BridgeTransfer {
  id:           string;
  srcChain:     Chain;
  dstChain:     Chain;
  srcAddress:   string;
  dstAddress:   string;
  srcTxHash?:   string;
  dstTxHash?:   string;
  amount:       string;
  token:        string;
  status:       BridgeStatus;
  confirmations: number;
  createdAt:    Date;
}

export interface ValidatorSignature {
  transferId:       string;
  validatorAddress: string;
  signature:        string;
  signedAt:         string;
}