// ─────────────────────────────────────────────────────────────────────────
// Single source of truth for per-network metadata used across the explorer:
// display label, native gas-fee symbol, and block-explorer URL templates.
//
// TO MOVE TO MAINNET LATER: this should be the only file that needs to
// change for the explorer's display layer. Swap each entry's `label` /
// `nativeSymbol` / `explorerTxBase` / `explorerAddressBase` for the mainnet
// equivalents, and flip `testnet` to false. (The RPC URLs and contract
// addresses used for on-chain reads/writes elsewhere in this service are
// separately driven by env vars — ETH_RPC/BSC_RPC/POLYGON_RPC/TRON_RPC and
// ETH_INRX_ADDRESS etc. — so a full mainnet cutover is: update those env
// vars, update this file, done. Nothing else in stablecoin.service.ts, the
// gateway, the frontend, or the Node BFF hardcodes testnet specifics; they
// all read from here or from GET /stablecoin/explorer/networks, which just
// serves this.)
// ─────────────────────────────────────────────────────────────────────────

export interface NetworkConfig {
  key: string;
  label: string;
  testnet: boolean;
  nativeSymbol: string;
  explorerTxBase: string;       // + txHash (+ query suffix for solana)
  explorerAddressBase: string;  // + address (+ query suffix for solana)
}

export const NETWORKS: Record<string, NetworkConfig> = {
  ethereum: {
    key: 'ethereum',
    label: 'Sepolia Ethereum',
    testnet: true,
    nativeSymbol: 'sepETH',
    explorerTxBase:      'https://sepolia.etherscan.io/tx/',
    explorerAddressBase: 'https://sepolia.etherscan.io/address/',
  },
  bsc: {
    key: 'bsc',
    label: 'BSC Testnet',
    testnet: true,
    nativeSymbol: 'tBNB',
    explorerTxBase:      'https://testnet.bscscan.com/tx/',
    explorerAddressBase: 'https://testnet.bscscan.com/address/',
  },
  polygon: {
    key: 'polygon',
    label: 'Polygon Amoy',
    testnet: true,
    nativeSymbol: 'POL(testnet)',
    explorerTxBase:      'https://amoy.polygonscan.com/tx/',
    explorerAddressBase: 'https://amoy.polygonscan.com/address/',
  },
  tron: {
    key: 'tron',
    label: 'Tron Nile',
    testnet: true,
    nativeSymbol: 'TRX(testnet)',
    explorerTxBase:      'https://nile.tronscan.org/#/transaction/',
    explorerAddressBase: 'https://nile.tronscan.org/#/address/',
  },
  solana: {
    key: 'solana',
    label: 'Solana Devnet',
    testnet: true,
    nativeSymbol: 'SOL(devnet)',
    explorerTxBase:      'https://explorer.solana.com/tx/',
    explorerAddressBase: 'https://explorer.solana.com/address/',
  },
};

export const NETWORK_KEYS = Object.keys(NETWORKS);

export function explorerTxUrl(chain: string, txHash?: string | null): string | null {
  const n = NETWORKS[chain];
  if (!n || !txHash) return null;
  return chain === 'solana' ? `${n.explorerTxBase}${txHash}?cluster=devnet` : `${n.explorerTxBase}${txHash}`;
}

export function explorerAddressUrl(chain: string, address?: string | null): string | null {
  const n = NETWORKS[chain];
  if (!n || !address) return null;
  return chain === 'solana' ? `${n.explorerAddressBase}${address}?cluster=devnet` : `${n.explorerAddressBase}${address}`;
}
