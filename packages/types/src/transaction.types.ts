export type TxType =
  | 'SEND'
  | 'RECEIVE'
  | 'MINT'
  | 'BURN'
  | 'BRIDGE_LOCK'
  | 'BRIDGE_MINT'
  | 'SWAP';

export type TxStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REVERTED';

export interface Transaction {
  id:          string;
  txHash?:     string;
  chain:       string;
  type:        TxType;
  amount:      string;
  tokenSymbol: string;
  fromAddress: string;
  toAddress:   string;
  status:      TxStatus;
  blockNumber?: number;
  createdAt:   Date;
  confirmedAt?: Date;
}

export interface TransactionResult {
  txHash:      string;
  chain:       string;
  status:      TxStatus;
  blockNumber?: number;
  gasUsed?:    string;
  timestamp:   number;
}