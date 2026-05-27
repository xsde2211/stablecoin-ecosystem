import React from 'react';
import type { TokenSymbol } from '@ecosystem/types';

const tokenConfig: Record<TokenSymbol, { symbol: string; bg: string; color: string }> = {
  INRX:  { symbol: 'e₹', bg: '#e6f3ef', color: '#0d6e54' },
  EGOLD: { symbol: '⬡',  bg: '#fef3dc', color: '#9a6200' },
  ESLVR: { symbol: '◇',  bg: '#f0f0f0', color: '#555555' },
};

interface TokenIconProps {
  token: TokenSymbol;
  size?: number;
}

export function TokenIcon({ token, size = 38 }: TokenIconProps) {
  const cfg = tokenConfig[token];
  return (
    <div style={{
      width:          size,
      height:         size,
      borderRadius:   '50%',
      background:     cfg.bg,
      color:          cfg.color,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      fontSize:       size * 0.37,
      fontWeight:     700,
      flexShrink:     0,
    }}>
      {cfg.symbol}
    </div>
  );
}