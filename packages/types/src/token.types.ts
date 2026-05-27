export type TokenSymbol = 'INRX' | 'EGOLD' | 'ESLVR';

export interface TokenInfo {
  symbol:   TokenSymbol;
  name:     string;
  decimals: number;
  // contract address per chain
  addresses: {
    tron?:     string;
    ethereum?: string;
    bsc?:      string;
    polygon?:  string;
    solana?:   string;
  };
}

export interface TokenPrice {
  symbol:    TokenSymbol;
  inrPrice:  string;
  usdPrice:  string;
  updatedAt: Date;
}

// Token metadata constants — import this anywhere
export const TOKEN_INFO: Record<TokenSymbol, TokenInfo> = {
  INRX: {
    symbol:    'INRX',
    name:      'e-Rupee Stablecoin',
    decimals:  6,
    addresses: {},
  },
  EGOLD: {
    symbol:   'EGOLD',
    name:     'eGold Token',
    decimals: 6,
    addresses: {},
  },
  ESLVR: {
    symbol:   'ESLVR',
    name:     'eSilver Token',
    decimals: 6,
    addresses: {},
  },
};