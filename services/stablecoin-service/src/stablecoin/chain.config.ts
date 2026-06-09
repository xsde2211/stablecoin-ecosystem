/**
 * Contract addresses from deployment JSONs.
 * EVM: contracts/evm/deployments/*-v2.json
 * Tron: contracts/tron/deployments/nile.json
 */

export interface TokenAddresses {
  INRX:  string;
  EGOLD: string;
  ESLVR: string;
}

export interface ChainInfo {
  chainId:      number;
  rpcEnvKey:    string;
  isEvm:        boolean;
  tokens:       TokenAddresses;
  oracleManager:    string;
  reserveVault:     string;
  treasuryTimelock: string;
}

export const CHAIN_INFO: Record<string, ChainInfo> = {
  sepolia: {
    chainId:      11155111,
    rpcEnvKey:    'ETH_RPC',
    isEvm:        true,
    tokens: {
      INRX:  '0x51A5F24560547f587999c331788aC495D40d95ba',
      EGOLD: '0x815bF86a0b353b0853c45E92dD5447A344a3dA62',
      ESLVR: '0x90Eec2B99d92dEbf8719AACFB173b32Dcf791D88',
    },
    oracleManager:    '0xfeA54211216c212fe4dEfEA9E01CA6673CCb48d1',
    reserveVault:     '0x1621C08E66aC3fB88dA2D438FC6F01D5dCE1db7D',
    treasuryTimelock: '0xD4048cbaC528fFE3B1D05Fbc73Fb1e41c0BB74F9',
  },
  bsc: {
    chainId:      97,
    rpcEnvKey:    'BSC_RPC',
    isEvm:        true,
    tokens: {
      INRX:  '0xD7dee32c7abFAF3c52F5E71b4c7a5371E055e32f',
      EGOLD: '0x0288658a6dEec372609b5CB34d8e988CFf67266F',
      ESLVR: '0xb108603eA0E23725c4B68BFb5A0A2137482E59BC',
    },
    oracleManager:    '0x7fcbaAb4B917498e4257cC1D4eedd10D8E981B34',
    reserveVault:     '0xC18ff9369B9aa703716c975C1aB0fF8fd1Ef50c1',
    treasuryTimelock: '0xd4DA8ac5CF290251Bd5D268131F7dFFc86b0eC90',
  },
  polygon: {
    chainId:      80002,
    rpcEnvKey:    'POLYGON_RPC',
    isEvm:        true,
    tokens: {
      INRX:  '0xd52280A15b30e5EdfFF858E7EC22266604358F26',
      EGOLD: '0x73Ade2F340d65b75b900B4042DF07Bfb83Dc9D13',
      ESLVR: '0xF6D3F099B8F11719bF77ec544e638BD5EB5D084C',
    },
    oracleManager:    '0xcABd0032307B3363E459585F8A05FBa03d0433ad',
    reserveVault:     '0xe9Db78FF69E307E5797395E32030CE4f08FBc6Ca',
    treasuryTimelock: '0x0288658a6dEec372609b5CB34d8e988CFf67266F',
  },
  tron: {
    chainId:      0,
    rpcEnvKey:    'TRON_RPC',
    isEvm:        false,
    tokens: {
      INRX:  '41f7245fca6ef7ea21cfd494b1e351dc569e495c78',
      EGOLD: '41c376618a143189cc795255dab8bc6c6f7e4db090',
      ESLVR: '41d8f46578c9852cbe21939d5f0dec708f3d5f87a9',
    },
    oracleManager:    '414213fe0175cfff8e9587c76b59b90251b81ad125',
    reserveVault:     '41f89fc9a2c6f54c25b977ad8aed7066321c3b4227',
    treasuryTimelock: '415dbc4f25a6855e940740b133b5aaa562f6cab949',
  },
};

export const EVM_CHAINS = ['sepolia', 'bsc', 'polygon'];
export const ALL_CHAINS  = ['sepolia', 'bsc', 'polygon', 'tron'];
export const ALL_TOKENS  = ['INRX', 'EGOLD', 'ESLVR'];

/** Token IDs for OracleManager / ReserveVault (keccak256 of symbol) */
export function getTokenBytes32(symbol: string): string {
  const { ethers } = require('ethers');
  return ethers.keccak256(ethers.toUtf8Bytes(symbol));
}
