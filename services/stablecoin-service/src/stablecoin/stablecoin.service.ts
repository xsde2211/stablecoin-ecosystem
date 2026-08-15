import {
  Injectable, BadRequestException,
  NotFoundException, Logger, OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers }        from 'ethers';
import { TronWeb }       from 'tronweb';
import axios              from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import { MintDto }       from './dto/mint.dto';
import { BurnDto }       from './dto/burn.dto';
import { TxType} from '@prisma/client';
import { NETWORKS, explorerTxUrl, explorerAddressUrl } from './networks.config';

// Full token ABI matching our INRX/EGold/ESilver contracts
const TOKEN_ABI = [
  'function mint(address to, uint256 amount, string reason)',
  'function burn(address from, uint256 amount, string reason)',
  'function totalSupply() view returns (uint256)',
  'function circulatingSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function paused() view returns (bool)',
  'function mintCap() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function totalBurned() view returns (uint256)',
  'function isBlacklisted(address) view returns (bool)',
  'function isFrozen(address) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

// TronWeb needs JSON-format ABI objects (name/type/inputs/outputs), NOT the
// ethers-style human-readable strings TOKEN_ABI above uses — the two are
// incompatible formats, TOKEN_ABI can't be reused as-is for Tron calls.
// This also sidesteps tronWeb.contract().at()'s auto-fetch-the-ABI-from-
// TronGrid behavior entirely. That auto-fetch turned out to be unreliable
// for more than just the read-only balance path — it's the same cause
// behind "contract.burn is not a function" in burnTronTokens/
// mintTronTokens below (methods never got attached, no thrown error
// pointing at why). Passing the ABI explicitly means no network
// round-trip to resolve it, and no dependency on that resolution
// succeeding — used for every Tron contract interaction in this file now,
// not just balance reads.
const TRON_TOKEN_ABI = [
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
    name: 'paused',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
    name: 'burn',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

// OracleManager ABI — for reading gold/silver prices, and now writing live updates
const ORACLE_ABI = [
  'function getPriceSafe(bytes32 tokenId) view returns (uint256 price, uint256 count)',
  'function getOracles(bytes32 tokenId) view returns (address[] addresses, string[] names, uint256[] prices, uint256[] updatedAts, bool[] actives, bool[] stales)',
  'function stalePriceThreshold() view returns (uint256)',
  'function updatePrice(bytes32 tokenId, uint256 price)',
];

// ReserveVault ABI — for proof of reserve
const RESERVE_ABI = [
  'function getProofOfReserve(bytes32 tokenId) view returns (uint256 totalReserve, uint256 circulatingSupply, uint256 backingRatioBps, bool isFullyBacked, uint256 lastAuditTimestamp, string lastAuditReport)',
  'function getActiveReserves(bytes32 tokenId) view returns (tuple(bytes32 tokenId, uint8 assetType, uint256 amount, string custodian, string proofHash, uint256 timestamp, address addedBy, bool active)[])',
];

const TOKEN_IDS: Record<string,string> = {
  INRX:  ethers.keccak256(ethers.toUtf8Bytes('INRX')),
  EGOLD: ethers.keccak256(ethers.toUtf8Bytes('EGOLD')),
  ESLVR: ethers.keccak256(ethers.toUtf8Bytes('ESLVR')),
};

const CHAINS = ['ethereum','bsc','polygon'] as const;

@Injectable()
export class StablecoinService implements OnModuleInit {
  private readonly logger = new Logger(StablecoinService.name);

  constructor(
    private prisma: PrismaService,
    private redis:  RedisService,
  ) {}

  async onModuleInit() {
    // Push a live price immediately at boot so the app isn't stuck showing
    // the stale deploy-time price for up to 5 minutes after a restart.
    this.updateAllLiveOraclePrices().catch(err =>
      this.logger.error(`Initial live price push failed: ${err.message}`)
    );
  }

  // ─── Token info for single chain ──────────────────────────────────────────

  async getTokenInfo(token: string, chain: string) {
    const address  = this.getTokenAddress(token, chain);
    const provider = this.getProvider(chain);
    const contract = new ethers.Contract(address, TOKEN_ABI, provider);

    // THE FIX: this used to be Promise.all(), so ANY single call failing —
    // e.g. EGOLD/ESLVR's deployed contract not implementing mintCap()/
    // totalMinted()/totalBurned()/circulatingSupply() the way INRX's does —
    // took down the entire request with a 500, even though totalSupply()
    // and paused() work fine on every token. Promise.allSettled() lets each
    // call fail independently; whatever a given contract doesn't support
    // just comes back as null instead of erroring the whole endpoint.
    const [supplyR, mintCapR, pausedR, totalMintedR, totalBurnedR, circulatingR] =
      await Promise.allSettled([
        contract.totalSupply(),
        contract.mintCap(),
        contract.paused(),
        contract.totalMinted(),
        contract.totalBurned(),
        contract.circulatingSupply(),
      ]);

    const value = <T,>(r: PromiseSettledResult<T>): T | null =>
      r.status === 'fulfilled' ? r.value : null;

    const supply      = value(supplyR);
    const mintCap      = value(mintCapR);
    const paused       = value(pausedR);
    const totalMinted  = value(totalMintedR);
    const totalBurned  = value(totalBurnedR);
    const circulating  = value(circulatingR);

    if (supply === null) {
      // totalSupply() failing means this isn't a "missing extra feature"
      // situation — the contract address itself is probably wrong for
      // this token/chain. Worth still surfacing as a real error here.
      throw new BadRequestException(`Unable to read ${token} on ${chain} — check the contract address is correct`);
    }

    const fmt = (v: bigint | null) => v !== null ? ethers.formatUnits(v, 6) : null;

    return {
      token,
      chain,
      address,
      totalSupply:       fmt(supply),
      circulatingSupply: fmt(circulating),
      mintCap:           fmt(mintCap),
      totalMinted:       fmt(totalMinted),
      totalBurned:       fmt(totalBurned),
      paused:            paused ?? false,
      utilizationPct:    mintCap !== null && mintCap > 0n
        ? ((Number(supply) / Number(mintCap)) * 100).toFixed(2) + '%'
        : null,
    };
  }

  // ─── Token info across all chains ──────────────────────────────────────────

  async getTokenInfoAllChains(token: string) {
    const results = await Promise.allSettled(
      CHAINS.map(c => this.getTokenInfo(token, c))
    );
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value);
  }

  // ─── All tokens all chains supply ──────────────────────────────────────────

  async getTotalSupplyAllTokens() {
    const tokens  = ['INRX','EGOLD','ESLVR'];
    const results = await Promise.allSettled(
      tokens.flatMap(t => CHAINS.map(c => this.getTokenInfo(t, c)))
    );
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value);
  }

  // ─── Live price feed — real gold/silver market prices, pushed on-chain ─────
  //
  // Runs every 5 minutes (plus once at startup via onModuleInit). Fetches:
  //   1. Live spot price of gold/silver in USD per troy ounce (gold-api.com —
  //      free, no API key required)
  //   2. Live USD→INR exchange rate (open.er-api.com — free, no API key)
  // then converts to INR per gram and submits it on-chain — from TWO
  // independent oracle wallets (ORACLE_1_PRIVATE_KEY, ORACLE_2_PRIVATE_KEY) —
  // via OracleManager.updatePrice(). OracleManager's own _aggregatePrice()
  // then takes the median across both submissions, so a single compromised
  // or misbehaving oracle wallet can't unilaterally set the price; the other
  // oracle's submission still anchors it.
  //
  // Setup required (one-time, not code): BOTH oracle addresses must already
  // be registered via OracleManager.registerOracle(tokenId, addr, name) by an
  // account holding MANAGER_ROLE, for every chain and for both EGOLD and
  // ESLVR. Consider also calling setMinOracles(2) so a price is only
  // considered valid once both have reported — otherwise a single oracle's
  // price still counts on its own if the other hasn't submitted yet.

  private static readonly GRAMS_PER_TROY_OUNCE = 31.1034768;
  private static readonly METAL_SYMBOL: Record<string,string> = { EGOLD: 'XAU', ESLVR: 'XAG' };

  // Both oracle signer keys — each submits independently so OracleManager has
  // more than one source to median across, per its own on-chain aggregation.
  private get oraclePrivateKeys(): string[] {
    const keys = [process.env.ORACLE_1_PRIVATE_KEY, process.env.ORACLE_2_PRIVATE_KEY]
      .filter((k): k is string => !!k);
    if (keys.length === 0) {
      throw new Error('No oracle keys configured — set ORACLE_1_PRIVATE_KEY / ORACLE_2_PRIVATE_KEY');
    }
    return keys;
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pushLiveOraclePrices() {
    try {
      await this.updateAllLiveOraclePrices();
    } catch (err: any) {
      this.logger.error(`Live oracle price feed failed: ${err.message}`);
    }
  }

  private static readonly ORACLE_PUSH_THRESHOLD_PCT = 0.3; // 0.3%

  async updateAllLiveOraclePrices() {
  const usdToInr = await this.fetchUsdToInrRate();

  for (const token of ['EGOLD', 'ESLVR']) {
    const usdPerOz = await this.fetchSpotPriceUsdPerOz(StablecoinService.METAL_SYMBOL[token]);
    const inrPerGram = (usdPerOz * usdToInr) / StablecoinService.GRAMS_PER_TROY_OUNCE;

    // ─── Fluctuation check — decided ONCE per token, before the per-chain loop ───
    const lastPriceKey = `lastOraclePrice:${token}`;
    const lastPriceRaw = await this.redis.get(lastPriceKey).catch(() => null);
    const lastPrice = lastPriceRaw ? parseFloat(lastPriceRaw) : null;

    if (lastPrice !== null) {
      const changePct = (Math.abs(inrPerGram - lastPrice) / lastPrice) * 100;
      if (changePct < StablecoinService.ORACLE_PUSH_THRESHOLD_PCT) {
        this.logger.log(
          `[${token}] Skipped push — ₹${inrPerGram.toFixed(2)}/gram is only ${changePct.toFixed(3)}% ` +
          `off the last pushed ₹${lastPrice.toFixed(2)}/gram (threshold: ${StablecoinService.ORACLE_PUSH_THRESHOLD_PCT}%)`
        );
        continue; // skip all chains for this token this cycle
      }
    }

    for (const chain of CHAINS) {
      try {
        await this.pushOraclePriceFromAllOracles(token, chain, inrPerGram);
      } catch (err: any) {
        this.logger.warn(`Oracle push failed [${token}/${chain}]: ${err.message}`);
      }
    }

    // Record what we just pushed so the next cron cycle has something to
    // compare against. No TTL — this should persist indefinitely until
    // overwritten by the next actual push, not expire between hourly runs.
    await this.redis.set(lastPriceKey, inrPerGram.toString()).catch(() => {});
  }
}

  // ─── Prices — sourced from the dashboard's own API (single source of truth) ───
  //
  // Per the product spec: stablecoin-service now uses the SAME price API the
  // dashboard frontend calls, instead of each hitting CoinGecko/gold-api.com
  // independently. This means one place to fix pricing formulas/spreads
  // (dashboard/api/*.ts) instead of two implementations that can silently
  // drift apart — which is exactly what started happening before this change
  // (this file had its own copy of the Tether-spread logic that had to be
  // manually kept in sync with the dashboard's).
  private static readonly DASHBOARD_API_URL =
    process.env.DASHBOARD_API_URL ?? 'https://stablecoin-ecosystem.vercel.app';

  private async fetchDashboardPrices(): Promise<{
    usdInr: number; goldUsdPerGram: number; goldInrPerGram: number;
    silverUsdPerGram: number; silverInrPerGram: number;
  }> {
    const cacheKey = 'livePrice:dashboardPrices';
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const res = await axios.get(`${StablecoinService.DASHBOARD_API_URL}/api/prices`, { timeout: 10000 });
    const data = res.data;
    if (!data?.usdInr || !data?.goldUsdPerGram || !data?.silverUsdPerGram) {
      throw new Error('Invalid response from dashboard price API');
    }

    // Still cached here too (short TTL) — the dashboard's own endpoint
    // already caches upstream, this just saves a network hop on our side
    // when the 5-min oracle cron and any live API request land close together.
    await this.redis.set(cacheKey, JSON.stringify(data), 60).catch(() => {});
    return data;
  }

  private async fetchSpotPriceUsdPerOz(metalSymbol: string): Promise<number> {
    const prices = await this.fetchDashboardPrices();
    if (metalSymbol === 'XAU') return prices.goldUsdPerGram * StablecoinService.GRAMS_PER_TROY_OUNCE;
    if (metalSymbol === 'XAG') return prices.silverUsdPerGram * StablecoinService.GRAMS_PER_TROY_OUNCE;
    throw new Error(`Unknown metal symbol: ${metalSymbol}`);
  }

  private async fetchUsdToInrRate(): Promise<number> {
    const prices = await this.fetchDashboardPrices();
    return prices.usdInr;
  }

  // ─── Live prices API — powers the fixed-quantity / floating-value model ───
  //
  // Per the updated product spec: a user's token QUANTITY never changes on
  // its own (only explicit mint/burn/send/bridge changes it) — what floats
  // is the token's real-world VALUE, computed fresh from live market data
  // every time this is called. 1 INRX tracks 1 INR of value, so its USD
  // price is just the USD/INR rate inverted; 1 EGOLD/ESLVR tracks 1 gram of
  // gold/silver. wallet-service calls this to compute each holding's
  // current market value without ever touching the on-chain balance.
  async getLivePrices() {
    const { usdInr, goldUsdPerGram, goldInrPerGram, silverUsdPerGram, silverInrPerGram } =
      await this.fetchDashboardPrices();

    return {
      usdInr,
      prices: {
        INRX:  { usd: 1 / usdInr,       inr: 1 },
        EGOLD: { usd: goldUsdPerGram,   inr: goldInrPerGram },
        ESLVR: { usd: silverUsdPerGram, inr: silverInrPerGram },
      },
      updatedAt: new Date().toISOString(),
    };
  }

  // Submits the same live price independently from each configured oracle
  // wallet. Each submission is its own on-chain tx, signed by a different
  // key — OracleManager treats them as separate oracles and medians across
  // whichever are currently active and non-stale.
  private async pushOraclePriceFromAllOracles(token: string, chain: string, inrPerGram: number) {
    const oracleAddr = this.getOracleAddress(chain);
    if (!oracleAddr) return; // chain not configured for oracle — skip quietly

    const provider     = this.getProvider(chain);
    const tokenId      = TOKEN_IDS[token];
    const priceScaled  = ethers.parseUnits(inrPerGram.toFixed(6), 6);

    const results = await Promise.allSettled(
      this.oraclePrivateKeys.map(async (key, i) => {
        const signer  = new ethers.Wallet(key, provider);
        const oracle  = new ethers.Contract(oracleAddr, ORACLE_ABI, signer);
        const tx      = await oracle.updatePrice(tokenId, priceScaled);
        const receipt = await tx.wait();
        this.logger.log(
          `[${chain}] Oracle ${i + 1} (${signer.address}) pushed ${token} = ₹${inrPerGram.toFixed(2)}/gram (tx ${receipt.hash})`
        );
        return receipt.hash;
      })
    );

    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) {
      for (const f of failed) {
        this.logger.warn(`[${chain}] An oracle submission for ${token} failed: ${f.reason?.message ?? f.reason}`);
      }
    }
    if (failed.length === results.length) {
      throw new Error(`All oracle submissions failed for ${token} on ${chain}`);
    }
  }

  // ─── Oracle prices (EGold and ESilver) ─────────────────────────────────────

  async getOraclePrice(token: string, chain: string) {
    const oracleAddr = this.getOracleAddress(chain);
    if (!oracleAddr) throw new BadRequestException(`OracleManager not configured for chain: ${chain}`);

    const provider = this.getProvider(chain);
    const oracle   = new ethers.Contract(oracleAddr, ORACLE_ABI, provider);
    const tokenId  = TOKEN_IDS[token];

    const [price, count] = await oracle.getPriceSafe(tokenId);

    return {
      token,
      chain,
      price:       price > 0n ? ethers.formatUnits(price, 6) : null,
      validOracles:count.toString(),
      unit:        'INR per gram',
      oracleAddress:oracleAddr,
    };
  }

  async getOraclePricesAllChains(token: string) {
    const results = await Promise.allSettled(
      CHAINS.map(c => this.getOraclePrice(token, c))
    );
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value);
  }

  // ─── Proof of reserve ──────────────────────────────────────────────────────

  async getProofOfReserve(token: string, chain: string) {
    const reserveAddr = this.getReserveVaultAddress(chain);
    if (!reserveAddr) throw new BadRequestException(`ReserveVault not configured for chain: ${chain}`);

    const provider = this.getProvider(chain);
    const vault    = new ethers.Contract(reserveAddr, RESERVE_ABI, provider);
    const tokenId  = TOKEN_IDS[token];

    const proof = await vault.getProofOfReserve(tokenId);

    return {
      token,
      chain,
      totalReserve:      ethers.formatUnits(proof[0], 6),
      circulatingSupply: ethers.formatUnits(proof[1], 6),
      backingRatioBps:   proof[2].toString(),
      backingRatioPct:   (Number(proof[2]) / 100).toFixed(2) + '%',
      isFullyBacked:     proof[3],
      lastAuditTimestamp:proof[4] > 0n ? new Date(Number(proof[4]) * 1000).toISOString() : null,
      lastAuditReport:   proof[5] || null,
      vaultAddress:      reserveAddr,
    };
  }

  // ─── Check if address is blacklisted or frozen ─────────────────────────────

  async checkAddress(address: string, chain: string) {
    const tokens   = ['INRX','EGOLD','ESLVR'];
    const provider = this.getProvider(chain);
    const results  = [];

    for (const token of tokens) {
      try {
        const tokenAddr = this.getTokenAddress(token, chain);
        const contract  = new ethers.Contract(tokenAddr, TOKEN_ABI, provider);
        const [bl, fr]  = await Promise.all([
          contract.isBlacklisted(address),
          contract.isFrozen(address),
        ]);
        results.push({ token, chain, address, blacklisted:bl, frozen:fr });
      } catch {}
    }
    return results;
  }

  // ─── Mint (direct — bypasses TreasuryTimelock — for testing only) ───────────

  async mintTokens(dto: MintDto, requestedBy: string) {
    this.logger.warn(`Direct mint called by ${requestedBy} — bypasses timelock!`);

    if (dto.chain === 'tron') {
      const { txHash, blockNumber, feeAmount, feeSymbol } = await this.mintTronTokens(dto);
      await this.recordTx(txHash, dto.chain, 'MINT', dto.amount, dto.token, 'treasury', dto.toAddress, requestedBy, { blockNumber, feeAmount, feeSymbol });
      this.logger.log(`Minted ${dto.amount} ${dto.token} to ${dto.toAddress} on tron`);
      return { txHash, status: 'CONFIRMED' };
    }

    const address  = this.getTokenAddress(dto.token, dto.chain);
    const provider = this.getProvider(dto.chain);

    const minterKey = process.env.MINTER_PRIVATE_KEY;
    if (!minterKey) throw new BadRequestException('SIGNER_1_PRIVATE_KEY not set — cannot mint directly');

    const signer   = new ethers.Wallet(minterKey, provider);
    console.log("Signer Address:", signer.address);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);
    const paused   = await contract.paused();
    if (paused) throw new BadRequestException(`${dto.token} is paused on ${dto.chain}`);

    const parsed  = ethers.parseUnits(dto.amount, 6);
    const tx      = await contract.mint(dto.toAddress, parsed, dto.reason);
    const receipt = await tx.wait();
    const { feeAmount, feeSymbol } = this.evmFee(receipt, dto.chain);

    await this.recordTx(receipt.hash, dto.chain, 'MINT', dto.amount, dto.token, 'treasury', dto.toAddress, requestedBy, { blockNumber: receipt.blockNumber, feeAmount, feeSymbol });
    this.logger.log(`Minted ${dto.amount} ${dto.token} to ${dto.toAddress} on ${dto.chain}`);
    return { txHash:receipt.hash, status:'CONFIRMED' };
  }

  // ─── Burn (direct) ─────────────────────────────────────────────────────────

  async burnTokens(dto: BurnDto, requestedBy: string) {
    if (dto.chain === 'tron') {
      const { txHash, blockNumber, feeAmount, feeSymbol } = await this.burnTronTokens(dto);
      await this.recordTx(txHash, dto.chain, 'BURN', dto.amount, dto.token, dto.fromAddress, 'treasury', requestedBy, { blockNumber, feeAmount, feeSymbol });
      this.logger.log(`Burned ${dto.amount} ${dto.token} from ${dto.fromAddress} on tron`);
      return { txHash, status: 'CONFIRMED' };
    }

    const address  = this.getTokenAddress(dto.token, dto.chain);
    const provider = this.getProvider(dto.chain);

    const burnerKey = process.env.BURNER_PRIVATE_KEY;
    if (!burnerKey) throw new BadRequestException('BURNER_PRIVATE_KEY not set — cannot burn directly');

    const signer   = new ethers.Wallet(burnerKey, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);
    const parsed   = ethers.parseUnits(dto.amount, 6);
    const tx       = await contract.burn(dto.fromAddress, parsed, dto.reason);
    const receipt  = await tx.wait();
    const { feeAmount, feeSymbol } = this.evmFee(receipt, dto.chain);

    await this.recordTx(receipt.hash, dto.chain, 'BURN', dto.amount, dto.token, dto.fromAddress, 'treasury', requestedBy, { blockNumber: receipt.blockNumber, feeAmount, feeSymbol });
    this.logger.log(`Burned ${dto.amount} ${dto.token} from ${dto.fromAddress} on ${dto.chain}`);
    return { txHash:receipt.hash, status:'CONFIRMED' };
  }

  // EVM gas fee = gasUsed * effective gasPrice, always denominated in the
  // chain's native currency (18 decimals) regardless of the token's own
  // decimals — hence formatEther, not formatUnits(...,6).
  private evmFee(receipt: any, chain: string): { feeAmount: string | null; feeSymbol: string | null } {
    try {
      const gasUsed  = receipt.gasUsed as bigint;
      const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice;
      if (gasUsed == null || gasPrice == null) return { feeAmount: null, feeSymbol: null };
      const feeWei = gasUsed * (gasPrice as bigint);
      return { feeAmount: ethers.formatEther(feeWei), feeSymbol: NETWORKS[chain]?.nativeSymbol ?? null };
    } catch {
      return { feeAmount: null, feeSymbol: null };
    }
  }

  // ─── TRON mint/burn — same contract source as EVM, compiled for TVM, so the
  // mint(address,uint256,string)/burn(address,uint256,string) interface is
  // identical; only the calling mechanism (TronWeb vs ethers) differs. ───────

  private async mintTronTokens(dto: MintDto): Promise<{ txHash: string; blockNumber: number | null; feeAmount: string | null; feeSymbol: string | null }> {
    const tokenAddr = this.getTronTokenAddress(dto.token);
    const minterKey = process.env.MINTER_TRON_PRIVATE_KEY;
    if (!minterKey) throw new BadRequestException('MINTER_TRON_PRIVATE_KEY not set — cannot mint directly');

    const tronWeb = new TronWeb({
      fullHost: process.env.TRON_RPC!,
      privateKey: minterKey,
      headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
    });
    // Explicit ABI, not .at() — see TRON_TOKEN_ABI's comment above.
    const contract = tronWeb.contract(TRON_TOKEN_ABI, tokenAddr);

    const paused = await contract.paused().call();
    if (paused) throw new BadRequestException(`${dto.token} is paused on tron`);

    const amountMicro = BigInt(Math.round(parseFloat(dto.amount) * 1_000_000)).toString();
    const txHash = await contract.mint(dto.toAddress, amountMicro, dto.reason).send({ feeLimit: 150_000_000 });
    return { txHash, ...(await this.tronFee(tronWeb, txHash)) };
  }

  private async burnTronTokens(dto: BurnDto): Promise<{ txHash: string; blockNumber: number | null; feeAmount: string | null; feeSymbol: string | null }> {
    const tokenAddr = this.getTronTokenAddress(dto.token);
    const burnerKey = process.env.BURNER_TRON_PRIVATE_KEY;
    if (!burnerKey) throw new BadRequestException('BURNER_TRON_PRIVATE_KEY not set — cannot burn directly');

    const tronWeb = new TronWeb({
      fullHost: process.env.TRON_RPC!,
      privateKey: burnerKey,
      headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
    });
    // Explicit ABI, not .at() — see TRON_TOKEN_ABI's comment above.
    const contract = tronWeb.contract(TRON_TOKEN_ABI, tokenAddr);

    const amountMicro = BigInt(Math.round(parseFloat(dto.amount) * 1_000_000)).toString();
    const txHash = await contract.burn(dto.fromAddress, amountMicro, dto.reason).send({ feeLimit: 150_000_000 });
    return { txHash, ...(await this.tronFee(tronWeb, txHash)) };
  }

  // Tron doesn't return fee/block info from .send() itself — has to be
  // looked up separately via getTransactionInfo() once the transaction is
  // on a solidity node. `fee` comes back in SUN (1 TRX = 1,000,000 SUN).
  // Non-fatal if this lookup fails (e.g. not yet indexed) — the mint/burn
  // itself already succeeded, so we still return the txHash either way,
  // just without fee/block info attached.
  private async tronFee(tronWeb: TronWeb, txHash: string): Promise<{ blockNumber: number | null; feeAmount: string | null; feeSymbol: string | null }> {
    try {
      await new Promise(r => setTimeout(r, 3000)); // brief delay before info is queryable
      const info: any = await tronWeb.trx.getTransactionInfo(txHash);
      if (!info?.blockNumber) return { blockNumber: null, feeAmount: null, feeSymbol: null };
      const feeSun = info.fee ?? 0;
      return {
        blockNumber: info.blockNumber,
        feeAmount: (feeSun / 1_000_000).toFixed(6),
        feeSymbol: NETWORKS.tron.nativeSymbol,
      };
    } catch {
      return { blockNumber: null, feeAmount: null, feeSymbol: null };
    }
  }

  private getTronTokenAddress(token: string): string {
    const map: Record<string, string | undefined> = {
      INRX:  process.env.TRON_INRX_ADDRESS,
      EGOLD: process.env.TRON_EGOLD_ADDRESS,
      ESLVR: process.env.TRON_ESLVR_ADDRESS,
    };
    const addr = map[token];
    if (!addr) throw new BadRequestException(`No TRON contract configured for ${token}`);
    return addr;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async recordTx(
    txHash: string, chain: string, type: string, amount: string,
    token: string, from: string, to: string, userId: string,
    extra: { blockNumber?: number | null; feeAmount?: string | null; feeSymbol?: string | null } = {},
  ) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain },
    });

    // listener-service watches the chain directly and can insert its own
    // Transaction row for this same (walletId, txHash) before we get here —
    // usually tagged type 'RECEIVE'/'SEND' from the raw Transfer event, not
    // the actual MINT/BURN. create().catch(P2002) used to "handle" that by
    // skipping the duplicate insert, but Prisma logs the underlying error
    // internally the moment the query fails — regardless of what the catch
    // block then does with it — which is what was spamming "prisma:error
    // ... Unique constraint failed" into the logs on every mint/burn even
    // though nothing was actually wrong. upsert() sidesteps that: on
    // conflict it just runs the update branch directly, no exception ever
    // thrown, nothing to log, and it also corrects the row to the right
    // type/addresses instead of leaving listener-service's guess in place.
    const txData = {
      chain, type: type as TxType, amount, tokenSymbol: token,
      fromAddress: from, toAddress: to, status: 'CONFIRMED' as const,
      confirmedAt: new Date(),
      ...(extra.blockNumber != null ? { blockNumber: BigInt(extra.blockNumber) } : {}),
      ...(extra.feeAmount != null ? { metadata: { feeAmount: extra.feeAmount, feeSymbol: extra.feeSymbol } } : {}),
    };

    await Promise.all([
      wallet
        ? this.prisma.transaction.upsert({
            where:  { walletId_txHash: { walletId: wallet.id, txHash } },
            create: { walletId: wallet.id, txHash, ...txData },
            update: txData,
          })
        : Promise.resolve(),

      this.prisma.auditLog.create({
        data: {
          userId,
          action:     `${type}_TOKENS`,
          entityType: 'Token',
          entityId:   txHash,
          payload:    { chain, token, amount, from, to, txHash },
        },
      }),
    ]);
  }

  // THE FIX: this used to construct a brand-new JsonRpcProvider on EVERY
  // call with no network specified — ethers then tries to auto-detect the
  // chain via its own eth_chainId call, and when the RPC endpoint is
  // unreachable/misconfigured, it retries that detection indefinitely,
  // producing the repeating "JsonRpcProvider failed to detect network and
  // cannot start up; retry in 1s" spam. Passing the chain ID explicitly via
  // staticNetwork skips detection entirely — a genuinely unreachable RPC
  // now fails once, clearly, on the actual call that needed it, instead of
  // hanging forever before ever getting there. Caching the instance (like
  // listener-service already does) also means we're not reconnecting from
  // scratch on every oracle-price push.
  private readonly EVM_CHAIN_IDS: Record<string, number> = {
    ethereum: 11155111,
    bsc:      97,
    polygon:  80002,
  };

  private evmProviders: Record<string, ethers.JsonRpcProvider> = {};

  private getProvider(chain: string): ethers.JsonRpcProvider {
    if (this.evmProviders[chain]) return this.evmProviders[chain];

    const map: Record<string,string> = {
      ethereum: process.env.ETH_RPC!,
      bsc:      process.env.BSC_RPC!,
      polygon:  process.env.POLYGON_RPC!,
    };
    if (!map[chain]) throw new BadRequestException(`Unsupported chain: ${chain}`);

    const chainId = this.EVM_CHAIN_IDS[chain];
    const provider = new ethers.JsonRpcProvider(
      map[chain],
      chainId ? ethers.Network.from(chainId) : undefined,
      {
        staticNetwork: chainId ? ethers.Network.from(chainId) : undefined,
        // One JSON-RPC call per HTTP request — public/free-tier RPCs often
        // rate-limit or reject batched arrays, which otherwise surfaces as
        // a confusing "missing response for request" error.
        batchMaxCount: 1,
      },
    );
    this.evmProviders[chain] = provider;
    return provider;
  }

  private getTokenAddress(token: string, chain: string): string {
    const map: Record<string,Record<string,string>> = {
      INRX:  { ethereum:process.env.ETH_INRX_ADDRESS!,  bsc:process.env.BSC_INRX_ADDRESS!,  polygon:process.env.POLYGON_INRX_ADDRESS! },
      EGOLD: { ethereum:process.env.ETH_EGOLD_ADDRESS!, bsc:process.env.BSC_EGOLD_ADDRESS!, polygon:process.env.POLYGON_EGOLD_ADDRESS! },
      ESLVR: { ethereum:process.env.ETH_ESLVR_ADDRESS!, bsc:process.env.BSC_ESLVR_ADDRESS!, polygon:process.env.POLYGON_ESLVR_ADDRESS! },
    };
    const addr = map[token]?.[chain];
    if (!addr) throw new BadRequestException(`No contract for ${token} on ${chain}. Check .env`);
    return addr;
  }

  private getOracleAddress(chain: string): string | undefined {
    const map: Record<string,string|undefined> = {
      ethereum: process.env.ETH_ORACLE_MANAGER_ADDRESS,
      bsc:      process.env.BSC_ORACLE_MANAGER_ADDRESS,
      polygon:  process.env.POLYGON_ORACLE_MANAGER_ADDRESS,
    };
    return map[chain];
  }

  private getReserveVaultAddress(chain: string): string | undefined {
    const map: Record<string,string|undefined> = {
      ethereum: process.env.ETH_RESERVE_VAULT_ADDRESS,
      bsc:      process.env.BSC_RESERVE_VAULT_ADDRESS,
      polygon:  process.env.POLYGON_RESERVE_VAULT_ADDRESS,
    };
    return map[chain];
  }

  private getBridgeAddress(chain: string): string | undefined {
    const map: Record<string,string|undefined> = {
      ethereum: process.env.ETH_BRIDGE_V2_ADDRESS,
      bsc:      process.env.BSC_BRIDGE_V2_ADDRESS,
      polygon:  process.env.POLYGON_BRIDGE_V2_ADDRESS,
      tron:     process.env.TRON_BRIDGE_V2_ADDRESS,
    };
    return map[chain];
  }

  // Read-only TronWeb instance — no private key needed for .call()/getTransactionInfo()
  // lookups, only for the mint/burn .send() calls elsewhere in this file.
  // TronWeb's constant-contract simulation (what .call() uses under the
  // hood for view functions like balanceOf) builds its request using
  // tronWeb.defaultAddress as the owner_address — without a privateKey (or
  // an explicit address) set on the instance, defaultAddress stays unset
  // and TronGrid's triggerconstantcontract endpoint can silently fail or
  // return a zeroed/garbage result rather than a clean error, which is
  // exactly what was making every Tron balance read come back as 0/null.
  // This never signs or broadcasts anything — only .call()/
  // getTransactionInfo() are ever used through this instance — so reusing
  // MINTER_TRON_PRIVATE_KEY here purely to give TronWeb an address context
  // for read simulation is safe.
  private getReadOnlyTronWeb(): TronWeb {
    const key = process.env.MINTER_TRON_PRIVATE_KEY || process.env.BURNER_TRON_PRIVATE_KEY;
    if (!key) {
      this.logger.warn('getReadOnlyTronWeb: neither MINTER_TRON_PRIVATE_KEY nor BURNER_TRON_PRIVATE_KEY is set — Tron reads may fail without a signer context');
    }
    return new TronWeb({
      fullHost: process.env.TRON_RPC!,
      ...(key ? { privateKey: key } : {}),
      headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
    });
  }

  // Live on-chain balanceOf(address) read for INRX on any chain — this is
  // what explorerAddress() uses for balance now, instead of summing
  // recorded Transaction rows, so it always matches the real contract
  // state even if a row was ever missed by both the direct-call path and
  // listener-service. Returns null (not 0) on any failure, so callers can
  // tell "confirmed zero balance" apart from "couldn't read the chain".
  private async liveBalanceOf(chain: string, holderAddress: string): Promise<string | null> {
    try {
      if (chain === 'tron') {
        const tronWeb = this.getReadOnlyTronWeb();
        // tronWeb.contract(ABI, address) — passing the ABI explicitly is
        // synchronous and needs no ABI lookup from TronGrid at all, unlike
        // .contract().at(address) (no ABI passed), which auto-fetches the
        // ABI over the network and was failing to attach any methods here
        // (hence "contract.balanceOf is not a function" with no deeper
        // error surfaced — the fetch/attach step failed silently).
        const contract = tronWeb.contract(TRON_TOKEN_ABI, this.getTronTokenAddress('INRX'));
        // Normalize to BASE58 (T...) before the call — TronWeb's contract
        // ABI encoder is built around base58 addresses; a raw 41-prefixed
        // hex string (no 0x) isn't reliably recognized as an address
        // parameter and can get silently mis-encoded into the calldata.
        const normalizedHolder = this.toDisplayAddress(holderAddress, 'tron');
        const raw = await contract.balanceOf(normalizedHolder).call();
        return ethers.formatUnits(raw.toString(), 6);
      }
      if (chain === 'solana') return null; // INRX on Solana isn't wired up yet
      const provider = this.getProvider(chain);
      const contract = new ethers.Contract(this.getTokenAddress('INRX', chain), TOKEN_ABI, provider);
      const raw: bigint = await contract.balanceOf(holderAddress);
      return ethers.formatUnits(raw, 6);
    } catch (err: any) {
      // Previously swallowed silently, which made "contract reverted",
      // "bad RPC/API key", and "malformed address" all look identical from
      // the outside (just an empty tile). Logging this doesn't change the
      // null-on-failure contract for callers, it just makes the actual
      // cause visible in the service logs when a balance unexpectedly
      // doesn't show up.
      this.logger.warn(`liveBalanceOf(${chain}, ${holderAddress}) failed: ${err?.message ?? err}`);
      return null;
    }
  }

  // Live fee/block lookup for a confirmed tx — used by decorateTx() as a
  // fallback whenever a row doesn't already have fee/block cached in its
  // `metadata`/`blockNumber` columns (e.g. it was written by
  // listener-service picking up a plain transfer nobody initiated via the
  // mint/burn/swap endpoints, which never captured fee data in the first
  // place). Costs one RPC call per network's node/API — see the caching
  // note on decorateTx() for why this doesn't mean one RPC call on every
  // single page view forever.
  private async fetchLiveFeeAndBlock(chain: string, txHash: string): Promise<{ blockNumber: number | null; feeAmount: string | null; feeSymbol: string | null }> {
    if (!txHash) return { blockNumber: null, feeAmount: null, feeSymbol: null };
    try {
      if (chain === 'tron') {
        const tronWeb = this.getReadOnlyTronWeb();
        const info: any = await tronWeb.trx.getTransactionInfo(txHash);
        if (!info?.blockNumber) return { blockNumber: null, feeAmount: null, feeSymbol: null };
        return {
          blockNumber: info.blockNumber,
          feeAmount: ((info.fee ?? 0) / 1_000_000).toFixed(6),
          feeSymbol: NETWORKS.tron.nativeSymbol,
        };
      }
      if (chain === 'solana') return { blockNumber: null, feeAmount: null, feeSymbol: null };
      const provider = this.getProvider(chain);
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return { blockNumber: null, feeAmount: null, feeSymbol: null };
      const { feeAmount, feeSymbol } = this.evmFee(receipt, chain);
      return { blockNumber: receipt.blockNumber, feeAmount, feeSymbol };
    } catch (err: any) {
      this.logger.warn(`fetchLiveFeeAndBlock(${chain}, ${txHash}) failed: ${err?.message ?? err}`);
      return { blockNumber: null, feeAmount: null, feeSymbol: null };
    }
  }

  // ─── Public Explorer ────────────────────────────────────────────────────
  // Unlike every other method in this class, these read ACROSS ALL WALLETS,
  // not just the requesting user's own — that's the entire point of a public
  // explorer (anyone can look up any hash/address, the same way Etherscan
  // doesn't require you to own an address to view it). Only ever called from
  // the unguarded ExplorerController below — never add @UseGuards to that.

  readonly EXPLORER_CHAINS = ['ethereum', 'bsc', 'polygon', 'tron', 'solana'];
  // 'RECEIVE' is intentionally not filterable — a wallet-to-wallet transfer
  // writes ONE row per side (sender's wallet gets 'SEND', recipient's
  // wallet gets 'RECEIVE'), which is correct for each user's own history
  // view, but the public explorer shows ONE transaction per on-chain event,
  // not two. See dedupeTxRows() below for how the pair is collapsed.
  private readonly EXPLORER_TYPES = ['SEND','MINT','BURN','BRIDGE_LOCK','BRIDGE_MINT','SWAP'];

  // How many raw rows we pull per source (Transaction table, BridgeTransfer
  // table) before de-duplicating/merging/paginating in application code.
  // This is NOT a true DB-level paginated query once bridge rows are
  // involved — see the long comment on mergeAndPaginate() below for why,
  // and what to do once real traffic outgrows this.
  private readonly EXPLORER_WINDOW = 3000;

  // TronGrid / raw event data sometimes carries addresses in hex ("41..." or
  // "0x41...") instead of base58; some direct-mint/burn callers may also
  // pass hex. Every address we hand back to the explorer UI must be base58
  // (T...) for tron, matching what a human actually recognizes as a Tron
  // address (the same normalization listener-service already applies before
  // it writes rows — this covers rows that predate that fix, or that came
  // from elsewhere without going through it).
  private toDisplayAddress(address: string, chain: string): string {
    if (chain !== 'tron' || !address) return address;
    if (address.startsWith('T')) return address; // already base58
    // NOTE: (?:41)? — a non-capturing group makes "41" optional as a whole.
    // Writing this as `41?` (no earlier version's bug) would instead mean
    // "literal 4, then optional 1", which only ever matched hex strings
    // that already happened to start with "4" — i.e. real Tron hex
    // addresses (always 41-prefixed), never a plain EVM address, silently
    // leaving those unconverted.
    if (!/^(0x)?(?:41)?[0-9a-fA-F]+$/.test(address)) return address; // not hex-shaped, leave it
    try {
      const stripped = address.replace(/^0x/, '');
      const withPrefix = stripped.startsWith('41') ? stripped : `41${stripped}`;
      return TronWeb.address.fromHex(withPrefix);
    } catch {
      return address; // malformed — surface the raw value rather than throw
    }
  }

  // EVM and Tron both use secp256k1 — a Tron address is just
  // Base58Check(0x41 + <same 20-byte hash an Ethereum address is>), so an
  // address on one chain and its "equivalent" on the other are the exact
  // same 20 bytes, just encoded differently, WHENEVER the same private key
  // was used to generate both. That's true for this project's own
  // addresses (the treasury/bridge/test wallets deliberately reuse one key
  // across EVM chains and Tron — see MINTER_PRIVATE_KEY vs
  // MINTER_TRON_PRIVATE_KEY), so deriving one from the other is a correct,
  // meaningful lookup here. It is NOT guaranteed to hold for two
  // independently-generated wallets a real user happens to own — the
  // frontend should label this as "if this address's key is reused across
  // chains", not assert it as fact for arbitrary addresses.
  private deriveRelatedAddresses(address: string): { evmAddress: string; tronAddress: string } | null {
    if (/^0x[0-9a-fA-F]{40}$/.test(address)) {
      try {
        const tronAddress = TronWeb.address.fromHex(`41${address.slice(2)}`);
        return { evmAddress: address, tronAddress };
      } catch {
        return null;
      }
    }
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
      try {
        const hex = TronWeb.address.toHex(address); // "41" + 40 hex chars
        return { evmAddress: `0x${hex.slice(2)}`, tronAddress: address };
      } catch {
        return null;
      }
    }
    return null;
  }

  // NOTE: async now — see the live-fetch fallback below. Every call site
  // must `await` this (single tx) or `Promise.all(rows.map(...))` (lists).
  private async decorateTx(tx: any) {
    const chain = tx.chain;
    let blockNumber = tx.blockNumber ? Number(tx.blockNumber) : null;
    let fee = tx.metadata?.feeAmount != null
      ? { amount: tx.metadata.feeAmount, symbol: tx.metadata.feeSymbol }
      : null;

    // Most rows don't have fee/block cached — recordTx() only captures it
    // for transactions that went through the direct mint/burn/swap
    // endpoints; anything listener-service picked up on its own (a plain
    // transfer nobody in this system initiated) never had it captured.
    // Rather than leave those permanently blank, fetch it live from the
    // network the first time it's viewed, and cache the result back onto
    // the row (best-effort — never blocks or fails the response) so every
    // later view of the same transaction is instant and RPC-free.
    if ((blockNumber == null || fee == null) && tx.txHash && tx.status === 'CONFIRMED') {
      const live = await this.fetchLiveFeeAndBlock(chain, tx.txHash);
      if (blockNumber == null && live.blockNumber != null) blockNumber = live.blockNumber;
      if (fee == null && live.feeAmount != null) fee = { amount: live.feeAmount, symbol: live.feeSymbol };

      if (tx.id && (live.blockNumber != null || live.feeAmount != null)) {
        this.prisma.transaction.update({
          where: { id: tx.id },
          data: {
            ...(live.blockNumber != null ? { blockNumber: BigInt(live.blockNumber) } : {}),
            ...(live.feeAmount != null ? { metadata: { ...(tx.metadata ?? {}), feeAmount: live.feeAmount, feeSymbol: live.feeSymbol } } : {}),
          },
        }).catch(() => {}); // best-effort cache write — a failure here must never affect what's shown
      }
    }

    return {
      txHash:      tx.txHash,
      chain,
      chainLabel:  NETWORKS[chain]?.label ?? chain,
      // A RECEIVE row and its paired SEND row describe the exact same
      // on-chain transfer from two wallets' perspectives — the public
      // explorer only ever shows one "SEND" per transfer, never the
      // internal RECEIVE label (see EXPLORER_TYPES comment above).
      type:        tx.type === 'RECEIVE' ? 'SEND' : tx.type,
      status:      tx.status,
      tokenSymbol: tx.tokenSymbol,
      amount:      tx.amount?.toString?.() ?? tx.amount,
      fromAddress: this.toDisplayAddress(tx.fromAddress, chain),
      toAddress:   this.toDisplayAddress(tx.toAddress, chain),
      blockNumber,
      fee,
      explorerUrl: explorerTxUrl(chain, tx.txHash),
      metadata:    tx.metadata ?? null,
      createdAt:   tx.createdAt,
      confirmedAt: tx.confirmedAt,
    };
  }

  // Collapses a SEND/RECEIVE pair for the same txHash into one row (prefers
  // the SEND-side row, since it's written by whoever initiated the
  // transfer and is the more "canonical" side — but if only a RECEIVE row
  // exists, e.g. an incoming transfer whose sender isn't one of our
  // registered wallets, that row still surfaces, just displayed as SEND by
  // decorateTx above rather than being dropped). MINT/BURN/SWAP rows never
  // collide with each other by txHash+walletId the same way, so they pass
  // through untouched. Rows with a null txHash (still-PENDING, no on-chain
  // hash yet) are never merged with each other.
  private dedupeTxRows(rows: any[]): any[] {
    const byHash = new Map<string, any>();
    const passthrough: any[] = [];
    for (const row of rows) {
      if (!row.txHash) { passthrough.push(row); continue; }
      const key = row.txHash.toLowerCase();
      const existing = byHash.get(key);
      if (!existing) { byHash.set(key, row); continue; }
      const existingIsReceive = existing.type === 'RECEIVE';
      const rowIsReceive      = row.type === 'RECEIVE';
      if (existingIsReceive && !rowIsReceive) byHash.set(key, row); // prefer non-RECEIVE
      // else keep whichever is already there
    }
    return [...byHash.values(), ...passthrough];
  }

  private dateRangeWhere(from?: string, to?: string): any {
    if (!from && !to) return undefined;
    const range: any = {};
    if (from) { const d = new Date(from); if (!isNaN(d.getTime())) range.gte = d; }
    if (to)   { const d = new Date(to);   if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); range.lte = d; } }
    return Object.keys(range).length ? range : undefined;
  }

  // BridgeTransfer rows live in a completely different table/shape than
  // Transaction (srcChain+dstChain+two separate tx hashes instead of one
  // chain+one hash) — nothing currently writes a BRIDGE_LOCK/BRIDGE_MINT
  // row into Transaction, so bridge activity was invisible to the explorer
  // entirely. This expands each matching BridgeTransfer into up to two
  // Transaction-shaped rows (a BRIDGE_LOCK leg on the source chain, a
  // BRIDGE_MINT leg on the destination chain) so it flows through the same
  // decorateTx()/pagination path as everything else.
  private async fetchBridgeLegs(opts: {
    token: string; type?: string; chain?: string; q?: string; dateRange?: any;
  }): Promise<any[]> {
    if (opts.type && opts.type !== 'BRIDGE_LOCK' && opts.type !== 'BRIDGE_MINT') return [];

    const where: any = { token: opts.token };
    if (opts.dateRange) where.createdAt = opts.dateRange;
    if (opts.chain) where.OR = [{ srcChain: opts.chain }, { dstChain: opts.chain }];
    if (opts.q) {
      const q = opts.q;
      where.OR = [
        ...(where.OR ?? []),
        { srcTxHash:  { contains: q, mode: 'insensitive' } },
        { dstTxHash:  { contains: q, mode: 'insensitive' } },
        { srcAddress: { contains: q, mode: 'insensitive' } },
        { dstAddress: { contains: q, mode: 'insensitive' } },
      ];
    }

    const transfers = await this.prisma.bridgeTransfer.findMany({
      where, orderBy: { createdAt: 'desc' }, take: this.EXPLORER_WINDOW,
    });

    const legs: any[] = [];
    for (const t of transfers) {
      const wantLock = !opts.type || opts.type === 'BRIDGE_LOCK';
      const wantMint = !opts.type || opts.type === 'BRIDGE_MINT';
      const chainOk = (c: string) => !opts.chain || opts.chain === c;

      if (wantLock && t.srcTxHash && chainOk(t.srcChain)) {
        legs.push({
          txHash: t.srcTxHash, chain: t.srcChain, type: 'BRIDGE_LOCK',
          status: 'CONFIRMED', tokenSymbol: t.token, amount: t.amount,
          fromAddress: t.srcAddress, toAddress: 'bridge-lock',
          blockNumber: null, metadata: { bridgeTransferId: t.id, dstChain: t.dstChain },
          createdAt: t.createdAt, confirmedAt: t.createdAt,
        });
      }
      if (wantMint && t.dstTxHash && chainOk(t.dstChain)) {
        legs.push({
          txHash: t.dstTxHash, chain: t.dstChain, type: 'BRIDGE_MINT',
          status: t.status === 'COMPLETED' || t.status === 'MINTED' ? 'CONFIRMED' : 'PENDING',
          tokenSymbol: t.token, amount: t.amount,
          fromAddress: 'bridge-mint', toAddress: t.dstAddress,
          blockNumber: null, metadata: { bridgeTransferId: t.id, srcChain: t.srcChain },
          createdAt: t.createdAt, confirmedAt: t.createdAt,
        });
      }
    }
    return legs;
  }

  async explorerStats(token = 'INRX') {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [supplyInfo, totalTxCount, tx24h, walletRows, bridgeLocked] = await Promise.all([
      this.getTokenInfoAllChains(token).catch(() => [] as any[]),
      this.prisma.transaction.count({ where: { tokenSymbol: token } }),
      this.prisma.transaction.count({ where: { tokenSymbol: token, createdAt: { gte: dayAgo } } }),
      this.prisma.transaction.findMany({
        where: { tokenSymbol: token },
        distinct: ['walletId'],
        select: { walletId: true },
      }),
      // How much INRX is currently sitting in each chain's bridge contract
      // — a live balanceOf(bridgeAddress) read per chain, same mechanism
      // as explorerAddress()'s per-network balances.
      Promise.all(
        this.EXPLORER_CHAINS.filter(c => c !== 'solana').map(async c => {
          const bridgeAddr = this.getBridgeAddress(c);
          if (!bridgeAddr) return null;
          const balance = await this.liveBalanceOf(c, bridgeAddr);
          return balance != null ? { chain: c, chainLabel: NETWORKS[c]?.label ?? c, address: bridgeAddr, balance } : null;
        }),
      ).then(rows => rows.filter((r): r is NonNullable<typeof r> => r != null)),
    ]);

    // circulatingSupply from getTokenInfoAllChains is already a formatted
    // decimal string (ethers.formatUnits) per chain — sum across EVM chains.
    // Tron's on-chain supply isn't included here (getTokenInfoAllChains only
    // covers ethereum/bsc/polygon); tron transactions are still fully
    // covered by the transaction list/filter below.
    const circulatingSupply = supplyInfo.reduce((sum: number, i: any) => {
      const c = parseFloat(i?.circulatingSupply ?? '0');
      return Number.isFinite(c) ? sum + c : sum;
    }, 0);

    const totalBridgeLocked = bridgeLocked.reduce((s, r) => s + Number(r.balance), 0).toFixed(2);

    // Real, verifiable contract addresses per chain — no RPC calls needed
    // (these come straight from env config), used for a "verified
    // contracts" trust section on the frontend. This is deliberately just
    // facts (address + a link anyone can check on that chain's own block
    // explorer) rather than any claim this service can't actually back up.
    const contracts = this.EXPLORER_CHAINS.filter(c => c !== 'solana').map(c => {
      try {
        const address = c === 'tron' ? this.getTronTokenAddress(token) : this.getTokenAddress(token, c);
        return { chain: c, chainLabel: NETWORKS[c]?.label ?? c, address, explorerUrl: explorerAddressUrl(c, address) };
      } catch {
        return null;
      }
    }).filter((r): r is NonNullable<typeof r> => r != null);

    return {
      token,
      circulatingSupply: circulatingSupply.toFixed(2),
      totalTxCount,
      tx24h,
      activeWallets: walletRows.length,
      bridgeLockedByNetwork: bridgeLocked,
      totalBridgeLocked,
      contracts,
      chains: this.EXPLORER_CHAINS,
      networks: NETWORKS,
      perChainSupply: supplyInfo,
    };
  }

  // GET /stablecoin/explorer/networks — single source of truth for chain
  // display labels, native gas symbols, and block-explorer URL templates.
  // The frontend (and the Node BFF) fetch this instead of hardcoding
  // network metadata, so a mainnet cutover only ever touches
  // networks.config.ts.
  explorerNetworks() {
    return { networks: NETWORKS, keys: this.EXPLORER_CHAINS };
  }

  async explorerTransactions(opts: {
    token?: string; page?: number; limit?: number;
    type?: string; chain?: string; q?: string; from?: string; to?: string;
  }) {
    const token = opts.token || 'INRX';
    const page  = Math.max(1, opts.page || 1);
    const limit = Math.min(100, Math.max(1, opts.limit || 25));
    const type  = opts.type && this.EXPLORER_TYPES.includes(opts.type) ? opts.type : undefined;
    const chain = opts.chain && opts.chain !== 'all' ? opts.chain : undefined;
    const q     = opts.q?.trim();
    const dateRange = this.dateRangeWhere(opts.from, opts.to);

    const where: any = { tokenSymbol: token };
    // 'SEND' in the UI means "any transfer, shown once" — that covers rows
    // actually stored as SEND *and* stand-alone RECEIVE rows (see
    // dedupeTxRows). Every other type filters exactly as stored.
    if (type === 'SEND') where.type = { in: ['SEND', 'RECEIVE'] };
    else if (type)        where.type = type as TxType;
    else                   where.type = { not: 'RECEIVE' as TxType }; // RECEIVE rows only survive if no SEND pair exists — handled by the second query below
    if (chain) where.chain = chain;
    if (dateRange) where.createdAt = dateRange;
    if (q) {
      // Search matches the hash or either address, in whatever form the
      // caller typed it (hex or, for tron, base58) — we don't try to
      // convert the search term itself, just match it literally against
      // what's actually stored.
      where.OR = [
        { txHash:      { contains: q, mode: 'insensitive' } },
        { fromAddress: { contains: q, mode: 'insensitive' } },
        { toAddress:   { contains: q, mode: 'insensitive' } },
      ];
    }

    // Two queries instead of one: the primary one excludes RECEIVE outright
    // (cheap, index-friendly), then a second only fetches RECEIVE rows
    // whose txHash has NO matching SEND row at all — the case worth
    // preserving (see dedupeTxRows). Skipped entirely when filtering to a
    // specific non-SEND type, since RECEIVE can never satisfy those.
    const receiveOnlyWhere = { ...where, type: 'RECEIVE' as TxType };
    const needsReceiveCheck = !type || type === 'SEND';

    const [txRows, receiveRows, bridgeLegs] = await Promise.all([
      this.prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, take: this.EXPLORER_WINDOW }),
      needsReceiveCheck
        ? this.prisma.transaction.findMany({ where: receiveOnlyWhere, orderBy: { createdAt: 'desc' }, take: this.EXPLORER_WINDOW })
        : Promise.resolve([]),
      this.fetchBridgeLegs({ token, type, chain, q, dateRange }),
    ]);

    const knownHashes = new Set(txRows.map(r => r.txHash?.toLowerCase()).filter(Boolean));
    const orphanReceives = receiveRows.filter(r => !r.txHash || !knownHashes.has(r.txHash.toLowerCase()));

    // Merge + sort on the RAW rows first (cheap, no RPC calls) — only the
    // page actually being returned gets decorated (which is where the
    // live fee/block RPC fallback happens), not the whole merged window.
    const mergedRaw = this.dedupeTxRows([...txRows, ...orphanReceives])
      .concat(bridgeLegs)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = mergedRaw.length;
    const pageRaw = mergedRaw.slice((page - 1) * limit, (page - 1) * limit + limit);
    const data = await Promise.all(pageRaw.map(r => this.decorateTx(r)));

    return { data, total, page, limit };
  }

  async explorerTransaction(txHash: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { txHash: { equals: txHash, mode: 'insensitive' } },
    });
    if (tx) return this.decorateTx(tx);

    // Not in Transaction — check whether it's a bridge leg instead.
    const bridge = await this.prisma.bridgeTransfer.findFirst({
      where: {
        OR: [
          { srcTxHash: { equals: txHash, mode: 'insensitive' } },
          { dstTxHash: { equals: txHash, mode: 'insensitive' } },
        ],
      },
    });
    if (bridge) {
      const isSrc = bridge.srcTxHash?.toLowerCase() === txHash.toLowerCase();
      return this.decorateTx(isSrc
        ? { txHash: bridge.srcTxHash, chain: bridge.srcChain, type: 'BRIDGE_LOCK', status: 'CONFIRMED', tokenSymbol: bridge.token, amount: bridge.amount, fromAddress: bridge.srcAddress, toAddress: 'bridge-lock', blockNumber: null, metadata: { bridgeTransferId: bridge.id, dstChain: bridge.dstChain }, createdAt: bridge.createdAt, confirmedAt: bridge.createdAt }
        : { txHash: bridge.dstTxHash, chain: bridge.dstChain, type: 'BRIDGE_MINT', status: ['COMPLETED','MINTED'].includes(bridge.status) ? 'CONFIRMED' : 'PENDING', tokenSymbol: bridge.token, amount: bridge.amount, fromAddress: 'bridge-mint', toAddress: bridge.dstAddress, blockNumber: null, metadata: { bridgeTransferId: bridge.id, srcChain: bridge.srcChain }, createdAt: bridge.createdAt, confirmedAt: bridge.createdAt },
      );
    }

    throw new NotFoundException(`No transaction found for hash ${txHash}`);
  }

  async explorerAddress(address: string, opts: { page?: number; limit?: number; chain?: string } = {}) {
    const page  = Math.max(1, opts.page || 1);
    const limit = Math.min(100, Math.max(1, opts.limit || 25));
    const chain = opts.chain && opts.chain !== 'all' ? opts.chain : undefined;

    // Whichever form was searched (EVM 0x... or Tron T...), derive its
    // counterpart on the other chain family — see deriveRelatedAddresses()
    // for why this is a valid, meaningful lookup for this project's own
    // addresses. `related` is null if the input doesn't look like either
    // form (e.g. malformed input) — everything below still works, it just
    // won't find a counterpart to add.
    const related = this.deriveRelatedAddresses(address);
    const evmAddress  = related?.evmAddress  ?? (/^0x[0-9a-fA-F]{40}$/.test(address) ? address : null);
    const tronAddress = related?.tronAddress ?? (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) ? address : null);

    // The address may have been given to us in whichever form the caller
    // has it in, in whichever case Tron hex/base58 the DB row happens to
    // store; also include the derived cross-chain counterpart so a lookup
    // by either the EVM or the Tron form of the same key surfaces BOTH
    // chains' transactions in one view, not just the form that was typed.
    const candidates = new Set([address]);
    if (evmAddress)  candidates.add(evmAddress);
    if (tronAddress) candidates.add(tronAddress);
    if (chain === 'tron' || !chain) candidates.add(this.toDisplayAddress(address, 'tron'));
    const addrList = Array.from(candidates);

    // Full transaction list for this address, across whichever network(s)
    // were asked for — reuses the same list/dedupe/bridge-merge path as
    // explorerTransactions so an address page shows exactly the same
    // "one row per real event" view.
    const addrWhere = {
      OR: [
        { fromAddress: { in: addrList, mode: 'insensitive' as const } },
        { toAddress:   { in: addrList, mode: 'insensitive' as const } },
      ],
    };

    const txWhereBase: any = { tokenSymbol: 'INRX', ...addrWhere };
    if (chain) txWhereBase.chain = chain;

    const [allTxRows, bridgeLegsAll] = await Promise.all([
      this.prisma.transaction.findMany({ where: txWhereBase, orderBy: { createdAt: 'desc' }, take: this.EXPLORER_WINDOW }),
      this.fetchBridgeLegs({ token: 'INRX', chain }).then(legs =>
        legs.filter(l => addrList.some(a => a.toLowerCase() === l.fromAddress?.toLowerCase() || a.toLowerCase() === l.toAddress?.toLowerCase()))
      ),
    ]);

    // Merge + sort raw rows first (no RPC calls), THEN decorate only the
    // page actually being returned — see the same note on
    // explorerTransactions above.
    const mergedRaw = this.dedupeTxRows(allTxRows)
      .concat(bridgeLegsAll)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = mergedRaw.length;
    const pageRaw = mergedRaw.slice((page - 1) * limit, (page - 1) * limit + limit);
    const data = await Promise.all(pageRaw.map(r => this.decorateTx(r)));

    // Balance, PER NETWORK — a live balanceOf(address) read against the
    // deployed INRX contract on each chain (not a ledger-derived sum of
    // recorded Transaction rows), so it always matches on-chain truth even
    // if a row was ever missed. Uses the EVM form of the address for EVM
    // chains and the Tron form for Tron, regardless of which form was
    // originally searched — that's the whole point of deriving both above.
    // A chain whose read fails (RPC down, no counterpart derivable, etc.)
    // is simply omitted rather than shown as zero, so a real zero balance
    // and "couldn't check" are never confused.
    const chainsToCheck = chain ? [chain] : this.EXPLORER_CHAINS.filter(c => c !== 'solana');
    const liveBalances = await Promise.all(
      chainsToCheck.map(async c => {
        const holder = c === 'tron' ? tronAddress : evmAddress;
        if (!holder) return { chain: c, balance: null as string | null };
        return { chain: c, balance: await this.liveBalanceOf(c, holder) };
      }),
    );

    const balancesByNetwork = liveBalances
      .filter(b => b.balance != null)
      .map(b => ({ chain: b.chain, chainLabel: NETWORKS[b.chain]?.label ?? b.chain, balance: Number(b.balance).toFixed(2) }));

    const totalBalance = balancesByNetwork
      .reduce((s, b) => s + Number(b.balance), 0)
      .toFixed(2);

    return {
      address,
      tokenSymbol: 'INRX',
      balance: totalBalance,          // kept for backward compatibility with existing frontend field name
      totalBalance,
      balancesByNetwork,
      relatedAddress: related,        // { evmAddress, tronAddress } or null — same key, other chain family
      txCount: total,
      data, total, page, limit,
    };
  }
}