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

  @Cron(CronExpression.EVERY_HOUR)
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
      const txHash = await this.mintTronTokens(dto);
      await this.recordTx(txHash, dto.chain, 'MINT', dto.amount, dto.token, 'treasury', dto.toAddress, requestedBy);
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

    await this.recordTx(receipt.hash, dto.chain, 'MINT', dto.amount, dto.token, 'treasury', dto.toAddress, requestedBy);
    this.logger.log(`Minted ${dto.amount} ${dto.token} to ${dto.toAddress} on ${dto.chain}`);
    return { txHash:receipt.hash, status:'CONFIRMED' };
  }

  // ─── Burn (direct) ─────────────────────────────────────────────────────────

  async burnTokens(dto: BurnDto, requestedBy: string) {
    if (dto.chain === 'tron') {
      const txHash = await this.burnTronTokens(dto);
      await this.recordTx(txHash, dto.chain, 'BURN', dto.amount, dto.token, dto.fromAddress, 'treasury', requestedBy);
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

    await this.recordTx(receipt.hash, dto.chain, 'BURN', dto.amount, dto.token, dto.fromAddress, 'treasury', requestedBy);
    this.logger.log(`Burned ${dto.amount} ${dto.token} from ${dto.fromAddress} on ${dto.chain}`);
    return { txHash:receipt.hash, status:'CONFIRMED' };
  }

  // ─── TRON mint/burn — same contract source as EVM, compiled for TVM, so the
  // mint(address,uint256,string)/burn(address,uint256,string) interface is
  // identical; only the calling mechanism (TronWeb vs ethers) differs. ───────

  private async mintTronTokens(dto: MintDto): Promise<string> {
    const tokenAddr = this.getTronTokenAddress(dto.token);
    const minterKey = process.env.MINTER_TRON_PRIVATE_KEY;
    if (!minterKey) throw new BadRequestException('MINTER_TRON_PRIVATE_KEY not set — cannot mint directly');

    const tronWeb = new TronWeb({
      fullHost: process.env.TRON_RPC!,
      privateKey: minterKey,
      headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
    });
    const contract = await tronWeb.contract().at(tokenAddr);

    const paused = await contract.paused().call();
    if (paused) throw new BadRequestException(`${dto.token} is paused on tron`);

    const amountMicro = BigInt(Math.round(parseFloat(dto.amount) * 1_000_000)).toString();
    return contract.mint(dto.toAddress, amountMicro, dto.reason).send({ feeLimit: 150_000_000 });
  }

  private async burnTronTokens(dto: BurnDto): Promise<string> {
    const tokenAddr = this.getTronTokenAddress(dto.token);
    const burnerKey = process.env.BURNER_TRON_PRIVATE_KEY;
    if (!burnerKey) throw new BadRequestException('BURNER_TRON_PRIVATE_KEY not set — cannot burn directly');

    const tronWeb = new TronWeb({
      fullHost: process.env.TRON_RPC!,
      privateKey: burnerKey,
      headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
    });
    const contract = await tronWeb.contract().at(tokenAddr);

    const amountMicro = BigInt(Math.round(parseFloat(dto.amount) * 1_000_000)).toString();
    return contract.burn(dto.fromAddress, amountMicro, dto.reason).send({ feeLimit: 150_000_000 });
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
}