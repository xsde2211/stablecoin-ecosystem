// ============================================================
// NETWORK REGISTRY — this is the only file you touch to add a
// new network later (mainnet migration, more testnets, etc).
// Swap is intentionally scoped to INRX/EGOLD/ESLVR only, converted
// on a single network at a time (no bridging involved) — that's a
// deliberate simplification, not a placeholder.
// ============================================================

export interface SwapNetwork {
  id:        string;   // matches the chain id used everywhere else in the repo
  label:     string;   // shown in the network picker
  deployed:  boolean;  // INRX/EGOLD/ESLVR actually minted/burnable here right now
  note?:     string;   // shown in the UI when deployed = false
}

export const SWAP_NETWORKS: SwapNetwork[] = [
  { id: 'ethereum', label: 'Sepolia',       deployed: true },
  { id: 'bsc',      label: 'BSC Testnet',   deployed: true },
  { id: 'polygon',  label: 'Polygon Amoy',  deployed: true },
  { id: 'tron',     label: 'Tron Nile',     deployed: true },
  // Listed so the picker already shows where this is headed, but
  // stablecoin-service has no mint/burn path for Solana yet (no deployed
  // SPL tokens, no SOLANA_*_ADDRESS env vars, no branch in
  // stablecoin.service.ts's mintTokens/burnTokens). Flip `deployed` to
  // true here once that exists — nothing else in swap-service needs to
  // change.
  { id: 'solana',   label: 'Solana Devnet', deployed: false,
    note: 'INRX/EGOLD/ESLVR aren\'t deployed on Solana yet.' },

  // Add a new network (e.g. mainnet later): one object here. Every other
  // file in this module reads from this list — nothing else to touch.
];

export const SWAP_TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;
export type SwapToken = typeof SWAP_TOKENS[number];

export function findNetwork(id: string): SwapNetwork | undefined {
  return SWAP_NETWORKS.find(n => n.id === id);
}

export function isSwapToken(symbol: string): symbol is SwapToken {
  return (SWAP_TOKENS as readonly string[]).includes(symbol.toUpperCase());
}
