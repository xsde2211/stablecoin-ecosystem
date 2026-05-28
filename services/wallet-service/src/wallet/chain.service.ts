import { Injectable, Logger } from '@nestjs/common';
import { ethers }  from 'ethers';
import { TronWeb } from 'tronweb';
import {
  Connection,
  PublicKey,
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

@Injectable()
export class ChainService {
  private readonly logger = new Logger(ChainService.name);

  // RPC providers — initialized once
  private ethProvider:     ethers.JsonRpcProvider;
  private bscProvider:     ethers.JsonRpcProvider;
  private polygonProvider: ethers.JsonRpcProvider;
  private solanaConn:      Connection;

  constructor() {
    this.ethProvider     = new ethers.JsonRpcProvider(process.env.ETH_RPC);
    this.bscProvider     = new ethers.JsonRpcProvider(process.env.BSC_RPC);
    this.polygonProvider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC);
    this.solanaConn      = new Connection(process.env.SOLANA_RPC!);
  }

  // ─── Balance fetching ────────────────────────────────────────────

  async getBalance(
    chain:        string,
    address:      string,
    tokenAddress: string,
  ): Promise<string> {
    try {
      switch (chain) {
        case 'ethereum': return this.getEVMBalance(this.ethProvider, address, tokenAddress);
        case 'bsc':      return this.getEVMBalance(this.bscProvider, address, tokenAddress);
        case 'polygon':  return this.getEVMBalance(this.polygonProvider, address, tokenAddress);
        case 'tron':     return this.getTRONBalance(address, tokenAddress);
        case 'solana':   return this.getSolanaBalance(address, tokenAddress);
        default:         return '0';
      }
    } catch (err) {
      this.logger.error(`Balance fetch failed for ${chain}:${address}`, err);
      return '0';
    }
  }

  private async getEVMBalance(
    provider:     ethers.JsonRpcProvider,
    address:      string,
    tokenAddress: string,
  ): Promise<string> {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const balance  = await contract.balanceOf(address);
    const decimals = await contract.decimals();
    return ethers.formatUnits(balance, decimals);
  }

  private async getTRONBalance(address: string, tokenAddress: string): Promise<string> {
    const tronWeb  = new TronWeb({ fullHost: process.env.TRON_RPC! });
    const contract = await tronWeb.contract(
      ['function balanceOf(address) view returns (uint256)'],
      tokenAddress,
    );
    const balance = await contract.balanceOf(address).call();
    return (BigInt(balance.toString()) / BigInt(1_000_000)).toString();
  }

  private async getSolanaBalance(
    walletAddress: string,
    mintAddress:   string,
  ): Promise<string> {
    const wallet = new PublicKey(walletAddress);
    const mint   = new PublicKey(mintAddress);
    const ata    = await getAssociatedTokenAddress(mint, wallet);

    try {
      const info = await this.solanaConn.getTokenAccountBalance(ata);
      return info.value.uiAmountString ?? '0';
    } catch {
      return '0';
    }
  }

  // ─── Token transfers ─────────────────────────────────────────────

  async sendEVMToken(
    chain:        string,
    mnemonic:     string,
    toAddress:    string,
    tokenAddress: string,
    amount:       string,
  ): Promise<string> {
    const providers: Record<string, ethers.JsonRpcProvider> = {
      ethereum: this.ethProvider,
      bsc:      this.bscProvider,
      polygon:  this.polygonProvider,
    };
    const provider = providers[chain];
    const wallet   = ethers.HDNodeWallet.fromPhrase(mnemonic).connect(provider);
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const decimals = await contract.decimals();
    const parsed   = ethers.parseUnits(amount, decimals);
    const tx       = await contract.transfer(toAddress, parsed);
    const receipt  = await tx.wait();
    return receipt.hash;
  }

  async sendTRONToken(
    mnemonic:     string,
    toAddress:    string,
    tokenAddress: string,
    amount:       string,
  ): Promise<string> {
    const hdNode   = ethers.HDNodeWallet.fromPhrase(mnemonic);
    const privKey  = hdNode.privateKey.slice(2);
    const tronWeb  = new TronWeb({ fullHost: process.env.TRON_RPC!, privateKey: privKey });
    const contract = await tronWeb.contract().at(tokenAddress);
    const amountMicro = BigInt(parseFloat(amount) * 1_000_000).toString();
    const txId = await contract.transfer(toAddress, amountMicro).send({
      feeLimit: 100_000_000,
    });
    return txId;
  }

  // ─── Token contract address lookup ───────────────────────────────

  getTokenAddress(chain: string, symbol: string): string {
    const map: Record<string, Record<string, string>> = {
      tron: {
        INRX:  process.env.TRON_INRX_ADDRESS!,
        EGOLD: process.env.TRON_EGOLD_ADDRESS!,
        ESLVR: process.env.TRON_ESLVR_ADDRESS!,
      },
      ethereum: {
        INRX:  process.env.ETH_INRX_ADDRESS!,
        EGOLD: process.env.ETH_EGOLD_ADDRESS!,
        ESLVR: process.env.ETH_ESLVR_ADDRESS!,
      },
      bsc: {
        INRX:  process.env.BSC_INRX_ADDRESS!,
        EGOLD: process.env.BSC_EGOLD_ADDRESS!,
        ESLVR: process.env.BSC_ESLVR_ADDRESS!,
      },
      polygon: {
        INRX:  process.env.POLYGON_INRX_ADDRESS!,
        EGOLD: process.env.POLYGON_EGOLD_ADDRESS!,
        ESLVR: process.env.POLYGON_ESLVR_ADDRESS!,
      },
    };
    return map[chain]?.[symbol] ?? '';
  }
}