/**
 * Chain configuration — maps chain names to RPC URLs, chain IDs,
 * and deployed V2 contract addresses from deployment JSONs.
 *
 * EVM deployments: contracts/evm/deployments/*-v2.json
 * Tron deployment: contracts/tron/deployments/nile.json
 */

export interface ChainConfig {
  chainId: number;
  rpcEnvKey: string;           // env variable name for RPC URL
  bridgeAddress: string;
  tokens: Record<string, string>; // token symbol → contract address
  isEvm: boolean;
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  // ─── Sepolia (Ethereum testnet) ───────────────────────────────
  sepolia: {
    chainId: 11155111,
    rpcEnvKey: 'ETH_RPC',
    bridgeAddress: '0x519ecfeBA19B5EDE6Cfd9eD7B6d33513924957Db',
    tokens: {
      INRX:  '0x51A5F24560547f587999c331788aC495D40d95ba',
      EGOLD: '0x815bF86a0b353b0853c45E92dD5447A344a3dA62',
      ESLVR: '0x90Eec2B99d92dEbf8719AACFB173b32Dcf791D88',
    },
    isEvm: true,
  },

  // ─── BSC Testnet ───────────────────────────────────────────────
  bsc: {
    chainId: 97,
    rpcEnvKey: 'BSC_RPC',
    bridgeAddress: '0x0458711652eDD24D107a929f598fb877aA165848',
    tokens: {
      INRX:  '0xD7dee32c7abFAF3c52F5E71b4c7a5371E055e32f',
      EGOLD: '0x0288658a6dEec372609b5CB34d8e988CFf67266F',
      ESLVR: '0xb108603eA0E23725c4B68BFb5A0A2137482E59BC',
    },
    isEvm: true,
  },

  // ─── Polygon Amoy ──────────────────────────────────────────────
  polygon: {
    chainId: 80002,
    rpcEnvKey: 'POLYGON_RPC',
    bridgeAddress: '0xC18ff9369B9aa703716c975C1aB0fF8fd1Ef50c1',
    tokens: {
      INRX:  '0xd52280A15b30e5EdfFF858E7EC22266604358F26',
      EGOLD: '0x73Ade2F340d65b75b900B4042DF07Bfb83Dc9D13',
      ESLVR: '0xF6D3F099B8F11719bF77ec544e638BD5EB5D084C',
    },
    isEvm: true,
  },

  // ─── Tron Nile testnet ─────────────────────────────────────────
  tron: {
    chainId: 0, // Tron doesn't use EVM chain IDs
    rpcEnvKey: 'TRON_RPC',
    bridgeAddress: '41acfd9de2324f3c2c5ece509a1e0e031641c7da19',
    tokens: {
      INRX:  '41f7245fca6ef7ea21cfd494b1e351dc569e495c78',
      EGOLD: '41c376618a143189cc795255dab8bc6c6f7e4db090',
      ESLVR: '41d8f46578c9852cbe21939d5f0dec708f3d5f87a9',
    },
    isEvm: false,
  },
};

/** Supported EVM chains for lock/mint/burn/unlock flows */
export const EVM_CHAINS = ['sepolia', 'bsc', 'polygon'];

/** Token IDs used in BridgeV2 (keccak256 of token symbol) */
export const TOKEN_IDS: Record<string, string> = {
  INRX:  '0x4b3a3b04f72cc3d9de6e45bbb3bceba42c55d2e0c8c28b96a7f7b35c00000000',
  EGOLD: '0xe97cda28cf3af0b0a1a8de21a5cd79e2bab27a28e58c2baaa9b96ca00000000',
  ESLVR: '0xc6b1fa2a37c77ef558d91b64e2e20cc7c5ce0e38cee832c2b38e87f400000000',
};

/** Compute TOKEN_IDs at runtime using ethers keccak256 for accuracy */
export function getTokenId(symbol: string): string {
  const { ethers } = require('ethers');
  return ethers.keccak256(ethers.toUtf8Bytes(symbol));
}
