export type ChainId = 'ethereum' | 'polygon' | 'bsc' | 'tron';

export interface ChainConfig {
  id: ChainId;
  label: string;
  kind: 'evm' | 'tron';
  /** Public read-only RPC. Override via the matching VITE_* env var. */
  rpc: string;
  tokens: {
    INRX: string;
    EGOLD: string;
    ESLVR: string;
  };
  /**
   * The bridge contract's address on this chain. "Smart contract balance"
   * means tokens currently LOCKED in the bridge (collateral backing the
   * bridged supply on other chains) — that's what accumulates via lock() —
   * NOT the token contract's own self-balance, which is basically always 0
   * unless a token is specifically designed to hold its own supply.
   */
  bridge: string;
  explorerTx?: string; // template for building a "view on explorer" link, {tx} placeholder
}

// Public, no-key-required RPC endpoints. These are read-only balance
// lookups only (balanceOf), never a signed transaction, so a shared public
// endpoint is fine here — swap via env vars if you'd rather point at a
// dedicated provider.
export const CHAINS: ChainConfig[] = [
  {
    id: 'ethereum',
    label: 'Ethereum',
    kind: 'evm',
    rpc: import.meta.env.VITE_ETH_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    tokens: {
      INRX: import.meta.env.VITE_ETH_INRX_ADDRESS || '0x51A5F24560547f587999c331788aC495D40d95ba',
      EGOLD: import.meta.env.VITE_ETH_EGOLD_ADDRESS || '0x815bF86a0b353b0853c45E92dD5447A344a3dA62',
      ESLVR: import.meta.env.VITE_ETH_ESLVR_ADDRESS || '0x90Eec2B99d92dEbf8719AACFB173b32Dcf791D88',
    },
    bridge: import.meta.env.VITE_ETH_BRIDGE_ADDRESS || '0x519ecfeBA19B5EDE6Cfd9eD7B6d33513924957Db',
  },
  {
    id: 'polygon',
    label: 'Polygon',
    kind: 'evm',
    rpc: import.meta.env.VITE_POLYGON_RPC || 'https://polygon-amoy-bor-rpc.publicnode.com',
    tokens: {
      INRX: import.meta.env.VITE_POLYGON_INRX_ADDRESS || '0xd52280A15b30e5EdfFF858E7EC22266604358F26',
      EGOLD: import.meta.env.VITE_POLYGON_EGOLD_ADDRESS || '0x73Ade2F340d65b75b900B4042DF07Bfb83Dc9D13',
      ESLVR: import.meta.env.VITE_POLYGON_ESLVR_ADDRESS || '0xF6D3F099B8F11719bF77ec544e638BD5EB5D084C',
    },
    // No known default here — set VITE_POLYGON_BRIDGE_ADDRESS in .env.
    bridge: import.meta.env.VITE_POLYGON_BRIDGE_ADDRESS || '',
  },
  {
    id: 'bsc',
    label: 'BSC',
    kind: 'evm',
    // NOTE: the raw public dataseed endpoint (bsc-testnet-dataseed.bnbchain.org)
    // is known to rate-limit/reject eth_getLogs and even plain calls under
    // light load — publicnode's mirror has been far more reliable for this.
    rpc: import.meta.env.VITE_BSC_RPC || 'https://bsc-testnet-rpc.publicnode.com',
    tokens: {
      INRX: import.meta.env.VITE_BSC_INRX_ADDRESS || '0xD7dee32c7abFAF3c52F5E71b4c7a5371E055e32f',
      EGOLD: import.meta.env.VITE_BSC_EGOLD_ADDRESS || '0x0288658a6dEec372609b5CB34d8e988CFf67266F',
      ESLVR: import.meta.env.VITE_BSC_ESLVR_ADDRESS || '0xb108603eA0E23725c4B68BFb5A0A2137482E59BC',
    },
    // No known default here — set VITE_BSC_BRIDGE_ADDRESS in .env.
    bridge: import.meta.env.VITE_BSC_BRIDGE_ADDRESS || '0x0458711652eDD24D107a929f598fb877aA165848',
  },
  {
    id: 'tron',
    label: 'Tron',
    kind: 'tron',
    rpc: import.meta.env.VITE_TRON_RPC || 'https://nile.trongrid.io',
    tokens: {
      INRX: import.meta.env.VITE_TRON_INRX_ADDRESS || '41f7245fca6ef7ea21cfd494b1e351dc569e495c78',
      EGOLD: import.meta.env.VITE_TRON_EGOLD_ADDRESS || '41c376618a143189cc795255dab8bc6c6f7e4db090',
      ESLVR: import.meta.env.VITE_TRON_ESLVR_ADDRESS || '41d8f46578c9852cbe21939d5f0dec708f3d5f87a9',
    },
    bridge: import.meta.env.VITE_TRON_BRIDGE_ADDRESS || '41acfd9de2324f3c2c5ece509a1e0e031641c7da19',
  },
];

export const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// Standard ("JSON") ABI shape tronweb needs — human-readable strings aren't
// accepted the way ethers.js accepts them.
export const TRC20_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
];

export const TROY_OUNCE_IN_GRAMS = 31.1034768;

// Gold-api.com's free tier is capped around 10 req/hour — 7 minutes between
// polls keeps us comfortably under that even accounting for retries.
export const METALS_POLL_MS = 7 * 60 * 1000;
// USD/INR + USDT pricing sources are far less rate-limited, so these can
// refresh much more often for a livelier feel.
export const FX_POLL_MS = 60 * 1000;
// How often to re-read on-chain contract balances for the selected network.
export const BALANCES_POLL_MS = 45 * 1000;