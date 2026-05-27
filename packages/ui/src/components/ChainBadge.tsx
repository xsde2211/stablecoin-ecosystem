import React from 'react';
import type { Chain } from '@ecosystem/types';

const chainConfig: Record<Chain, { label: string; color: string; bg: string }> = {
  tron:     { label: 'TRON',     color: '#b91c1c', bg: '#fef2f2' },
  ethereum: { label: 'ETH',      color: '#1d4ed8', bg: '#eff6ff' },
  bsc:      { label: 'BSC',      color: '#92400e', bg: '#fffbeb' },
  polygon:  { label: 'Polygon',  color: '#6d28d9', bg: '#f5f3ff' },
  solana:   { label: 'Solana',   color: '#5b21b6', bg: '#f5f3ff' },
};

interface ChainBadgeProps {
  chain: Chain;
}

export function ChainBadge({ chain }: ChainBadgeProps) {
  const cfg = chainConfig[chain];
  return (
    <span style={{
      background:   cfg.bg,
      color:        cfg.color,
      padding:      '2px 8px',
      borderRadius: '20px',
      fontSize:     '11px',
      fontWeight:   600,
    }}>
      {cfg.label}
    </span>
  );
}