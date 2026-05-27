export type Chain = 'tron' | 'ethereum' | 'bsc' | 'polygon' | 'solana';

export interface WalletAddresses {
  tron:     string;
  ethereum: string;
  bsc:      string;
  polygon:  string;
  solana:   string;
}

export interface WalletBalance {
  chain:    Chain;
  address:  string;
  symbol:   string;
  balance:  string;   // always string — avoids float precision issues
  decimals: number;
  usdValue?: string;
  inrValue?: string;
}

export interface SendTokenDto {
  fromChain:    Chain;
  toAddress:    string;
  tokenAddress: string;
  symbol:       string;
  amount:       string;
}

export interface WalletCreatedResponse {
  mnemonic:  string;   // shown ONCE to user, never stored in plaintext
  addresses: WalletAddresses;
}