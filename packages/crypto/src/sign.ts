import { ethers }  from 'ethers';
import { TronWeb } from 'tronweb';
import { Keypair, Transaction as SolTx } from '@solana/web3.js';
import { deriveSolanaKeypair } from './derive';
import type { Chain } from '@ecosystem/types';

/**
 * Sign a raw EVM transaction (works for Ethereum, BSC, Polygon)
 * Returns the signed tx hex ready to broadcast
 */
export async function signEVMTransaction(
  mnemonic: string,
  tx: ethers.TransactionRequest,
  rpcUrl: string,
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet   = ethers.HDNodeWallet.fromPhrase(mnemonic).connect(provider);
  return wallet.signTransaction(tx);
}

/**
 * Sign and broadcast an EVM token transfer
 * Returns transaction hash
 */
export async function sendEVMToken(
  mnemonic:     string,
  rpcUrl:       string,
  tokenAddress: string,
  toAddress:    string,
  amount:       bigint,
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet   = ethers.HDNodeWallet.fromPhrase(mnemonic).connect(provider);

  const erc20 = new ethers.Contract(
    tokenAddress,
    ['function transfer(address to, uint256 amount) returns (bool)'],
    wallet,
  );

  const tx = await erc20.transfer(toAddress, amount);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Sign and broadcast a TRON TRC20 token transfer
 * Returns transaction ID
 */
export async function sendTRONToken(
  mnemonic:     string,
  tronRpc:      string,
  tokenAddress: string,
  toAddress:    string,
  amount:       string,
): Promise<string> {
  const hdNode    = ethers.HDNodeWallet.fromPhrase(mnemonic);
  const privKey   = hdNode.privateKey.slice(2);

  const tronWeb   = new TronWeb({
    fullHost:   tronRpc,
    privateKey: privKey,
  });

  const contract = await tronWeb.contract().at(tokenAddress);
  const txId     = await contract.transfer(toAddress, amount).send({
    feeLimit: 100_000_000,
  });
  return txId;
}

/**
 * Sign a message with EVM wallet (used by bridge validators)
 */
export async function signMessage(
  mnemonic: string,
  message:  string,
): Promise<string> {
  const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic);
  return wallet.signMessage(message);
}