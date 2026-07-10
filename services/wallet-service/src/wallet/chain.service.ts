import { Injectable, Logger } from '@nestjs/common';
import { ethers }             from 'ethers';
import { TronWeb }            from 'tronweb';
import { Connection, PublicKey } from '@solana/web3.js';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

const TRC20_ABI = [
  { constant:true, inputs:[{name:'_owner',type:'address'}], name:'balanceOf',
    outputs:[{name:'balance',type:'uint256'}], type:'function' },
  { constant:false, inputs:[{name:'_to',type:'address'},{name:'_value',type:'uint256'}],
    name:'transfer', outputs:[{name:'',type:'bool'}], type:'function' },
];

// Every token in this system (INRX, EGOLD, ESLVR) is deployed with 6
// decimals on every chain — confirmed by stablecoin-service, bridge-service,
// and this file's own sendEVMToken/sendTRONToken, all of which already
// hardcode 6 rather than reading it on-chain. getBalance() and
// sendEVMToken() were the two places still calling contract.decimals() on
// every single request — that's an extra `eth_call` per token, per balance
// check, for a value that never changes. With 3 tokens × up to 4 EVM
// chains, a single "get all balances" request could fire 24 RPC calls
// instead of 12, which is very easy to trip Infura's free-tier rate limit
// (the "-32005 Too Many Requests" you were seeing).
const TOKEN_DECIMALS = 6;

@Injectable()
export class ChainService {
  private readonly logger = new Logger(ChainService.name);

  private readonly ethProvider:     ethers.JsonRpcProvider;
  private readonly bscProvider:     ethers.JsonRpcProvider;
  private readonly polygonProvider: ethers.JsonRpcProvider;
  private readonly solanaConn:      Connection;

  // Very short-lived in-memory cache so rapid re-renders / near-simultaneous
  // requests (e.g. Dashboard and TokenDetail both mounting at once) don't
  // each fire their own full round of RPC calls for the same data.
  private readonly balanceCache = new Map<string, { value: string; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 8_000;

  constructor() {
    this.ethProvider     = new ethers.JsonRpcProvider(process.env.ETH_RPC!);
    this.bscProvider     = new ethers.JsonRpcProvider(process.env.BSC_RPC!);
    this.polygonProvider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC!);
    this.solanaConn      = new Connection(process.env.SOLANA_RPC!);
  }

  // ─── Token contract address lookup ──────────────────────────────────────────

  getTokenAddress(chain: string, symbol: string): string {
    const map: Record<string, Record<string, string>> = {
      tron: {
        INRX:  process.env.TRON_INRX_ADDRESS  ?? '',
        EGOLD: process.env.TRON_EGOLD_ADDRESS  ?? '',
        ESLVR: process.env.TRON_ESLVR_ADDRESS  ?? '',
      },
      ethereum: {
        INRX:  process.env.ETH_INRX_ADDRESS   ?? '',
        EGOLD: process.env.ETH_EGOLD_ADDRESS   ?? '',
        ESLVR: process.env.ETH_ESLVR_ADDRESS   ?? '',
      },
      bsc: {
        INRX:  process.env.BSC_INRX_ADDRESS   ?? '',
        EGOLD: process.env.BSC_EGOLD_ADDRESS   ?? '',
        ESLVR: process.env.BSC_ESLVR_ADDRESS   ?? '',
      },
      polygon: {
        INRX:  process.env.POLYGON_INRX_ADDRESS  ?? '',
        EGOLD: process.env.POLYGON_EGOLD_ADDRESS ?? '',
        ESLVR: process.env.POLYGON_ESLVR_ADDRESS ?? '',
      },
    };
    return map[chain]?.[symbol] ?? '';
  }

  // ─── Balance fetching ────────────────────────────────────────────────────────

  async getBalance(chain: string, address: string, tokenAddress: string): Promise<string> {
    const cacheKey = `${chain}:${address}:${tokenAddress}`;
    const cached   = this.balanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    try {
      let value: string;
      switch (chain) {
        // THE OTHER BUG: these three lines were `return this.getXBalance(...)`
        // — returning the promise directly instead of awaiting it. A
        // try/catch can only catch a rejection that happens BEFORE the
        // function returns; `return somePromise` (no await) hands the
        // promise straight to the caller, so if it later rejects, this
        // catch block never runs. That's why a rate-limit error from
        // Infura was reaching NestJS's global ExceptionsHandler as a raw
        // uncaught 500 instead of being logged here and turned into '0'.
        case 'ethereum': value = await this.withRetry(() => this.getEVMBalance(this.ethProvider,     address, tokenAddress)); break;
        case 'bsc':      value = await this.withRetry(() => this.getEVMBalance(this.bscProvider,     address, tokenAddress)); break;
        case 'polygon':  value = await this.withRetry(() => this.getEVMBalance(this.polygonProvider, address, tokenAddress)); break;
        case 'tron':     value = await this.getTRONBalance(address, tokenAddress); break;
        case 'solana':   value = await this.getSolanaBalance(address, tokenAddress); break;
        default:         value = '0';
      }
      this.balanceCache.set(cacheKey, { value, expiresAt: Date.now() + this.CACHE_TTL_MS });
      return value;
    } catch (err: any) {
      this.logger.error(`Balance fetch failed [${chain}:${address.slice(0,10)}]: ${err.message}`);
      return '0';
    }
  }

  // Retries only on rate-limit responses (Infura's -32005, or any "Too Many
  // Requests" style error) — anything else fails fast and falls through to
  // getBalance()'s catch block above.
  private async withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 800): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const isRateLimited =
          err?.info?.error?.code === -32005 ||
          err?.error?.code === -32005 ||
          /too many requests/i.test(err?.message ?? err?.shortMessage ?? '');
        if (!isRateLimited || attempt >= retries) throw err;
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }

  private async getEVMBalance(
    provider: ethers.JsonRpcProvider,
    address:  string,
    token:    string,
  ): Promise<string> {
    const contract = new ethers.Contract(token, ERC20_ABI, provider);
    const balance  = await contract.balanceOf(address);
    return ethers.formatUnits(balance, TOKEN_DECIMALS);
  }

  private async getTRONBalance(address: string, tokenAddress: string): Promise<string> {
    const tronWeb = new TronWeb({
      fullHost: process.env.TRON_RPC!,
      headers:  { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
    });
    tronWeb.setAddress(address);
    const contract = await tronWeb.contract(TRC20_ABI, tokenAddress);
    const balance  = await contract.balanceOf(address).call();
    return (BigInt(balance.toString()) / 1_000_000n).toString();
  }

  private async getSolanaBalance(walletAddress: string, mintAddress: string): Promise<string> {
    try {
      const splToken = await import('@solana/spl-token');
      const wallet   = new PublicKey(walletAddress);
      const mint     = new PublicKey(mintAddress);
      const ata      = await splToken.getAssociatedTokenAddress(mint, wallet);
      const info     = await this.solanaConn.getTokenAccountBalance(ata);
      return info.value.uiAmountString ?? '0';
    } catch {
      return '0';
    }
  }

  // ─── Token transfer — EVM ────────────────────────────────────────────────────

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
    if (!provider) throw new Error(`Unsupported EVM chain: ${chain}`);

    const wallet   = ethers.HDNodeWallet.fromPhrase(mnemonic).connect(provider);
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const parsed   = ethers.parseUnits(amount, TOKEN_DECIMALS);

    const tx      = await contract.transfer(toAddress, parsed);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── Token transfer — TRON ──────────────────────────────────────────────────

  async sendTRONToken(
    mnemonic:     string,
    toAddress:    string,
    tokenAddress: string,
    amount:       string,
  ): Promise<string> {
    const hdNode  = ethers.HDNodeWallet.fromPhrase(mnemonic);
    const privKey = hdNode.privateKey.slice(2);

    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: privKey,
      headers:    { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
    });

    const contract    = await tronWeb.contract().at(tokenAddress);
    const amountMicro = BigInt(Math.round(parseFloat(amount) * 1_000_000)).toString();

    const txId = await contract.transfer(toAddress, amountMicro).send({
      feeLimit: 100_000_000,
    });

    return txId;
  }

  // ─── Address derivation helpers ──────────────────────────────────────────────

  deriveEVMAddress(mnemonic: string): string {
    return ethers.HDNodeWallet.fromPhrase(mnemonic).address;
  }

  deriveTRONAddress(mnemonic: string): string {
    const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic);
    const tronWeb = new TronWeb({ fullHost: process.env.TRON_RPC! });
    return tronWeb.address.fromPrivateKey(hdNode.privateKey.slice(2)) as string;
  }
}