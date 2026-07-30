export interface SwapNetwork {
  id:       string;
  label:    string;
  deployed: boolean;
  note?:    string;
}

export type SwapToken = 'INRX' | 'EGOLD' | 'ESLVR';

export interface SwapQuoteRequest {
  network:      string;
  fromToken:    SwapToken;
  toToken:      SwapToken;
  amount:       string;
  walletIndex?: number;
}

export interface SwapQuote {
  quoteId:   string;
  network:   string;
  from:      { token: SwapToken; amount: string; priceUsd: number };
  to:        { token: SwapToken; amount: string; priceUsd: number };
  rate:      string;
  feeBps:    number;
  feeUsd:    string;
  expiresAt: string;
}

export interface SwapExecuteRequest { quoteId: string; }

export interface SwapExecuteResult {
  status:  'CONFIRMED';
  network: string;
  from:    { token: SwapToken; amount: string; txHash: string };
  to:      { token: SwapToken; amount: string; txHash: string };
}
