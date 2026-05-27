import { ethers }  from 'ethers';
import { TronWeb } from 'tronweb';
import { Keypair } from '@solana/web3.js';
import { mnemonicToSeed } from './mnemonic';
import type { WalletAddresses } from '@ecosystem/types';

/**
 * From ONE mnemonic, derive addresses for all 5 chains.
 * This is how Trust Wallet / MetaMask work internally.
 *
 * Derivation paths used:
 *   EVM chains  →  m/44'/60'/0'/0/0  (standard Ethereum path)
 *   TRON        →  same path, different address encoding
 *   Solana      →  first 32 bytes of seed (simplified)
 */
export function deriveAllAddresses(mnemonic: string): WalletAddresses {
  // EVM: uses ethers HDNodeWallet
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic);
  const evmAddress = hdNode.address;

  // TRON: same private key, different Base58 encoding
  const tronPrivKey = hdNode.privateKey.slice(2); // remove 0x prefix
  const tronAddress = TronWeb.address.fromPrivateKey(tronPrivKey) as string;

  // Solana: derive from seed bytes
  const seed = mnemonicToSeed(mnemonic);
  const solanaKeypair = Keypair.fromSeed(seed.slice(0, 32));

  return {
    ethereum: evmAddress,
    bsc:      evmAddress,    // same address on all EVM chains
    polygon:  evmAddress,    // same address on all EVM chains
    tron:     tronAddress,
    solana:   solanaKeypair.publicKey.toBase58(),
  };
}

// Get just the private key for a specific chain
export function derivePrivateKey(
  mnemonic: string,
  chain: 'ethereum' | 'bsc' | 'polygon' | 'tron'
): string {
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic);
  return hdNode.privateKey; // 0x prefixed hex
}

// Get Solana keypair from mnemonic
export function deriveSolanaKeypair(mnemonic: string): Keypair {
  const seed = mnemonicToSeed(mnemonic);
  return Keypair.fromSeed(seed.slice(0, 32));
}