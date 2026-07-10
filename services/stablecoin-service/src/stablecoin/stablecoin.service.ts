import {
  Injectable, BadRequestException,
  NotFoundException, Logger, OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers }        from 'ethers';
import axios              from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import { MintDto }       from './dto/mint.dto';
import { BurnDto }       from './dto/burn.dto';
import { TxType } from '@prisma/client';

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
    // If the app happens to start during a network blip (as seen with a
    // full DNS outage taking out every external host at once), give it one
    // delayed retry rather than silently waiting for the next 5-minute
    // cron tick — a boot-time hiccup is usually gone within a few seconds.
    this.updateAllLiveOraclePrices().catch(async (err) => {
      this.logger.warn(`Initial live price push failed (${err.message}), retrying once in 15s`);
      await new Promise(r => setTimeout(r, 15000));
      try {
        await this.updateAllLiveOraclePrices();
      } catch (err2: any) {
        this.logger.error(`Initial live price push retry also failed: ${err2.message} — will pick up on the next 5-minute cycle`);
      }
    });
  }

  // ─── Token info for single chain ──────────────────────────────────────────

  async getTokenInfo(token: string, chain: string) {
    const address  = this.getTokenAddress(token, chain);
    const provider = this.getProvider(chain);
    const contract = new ethers.Contract(address, TOKEN_ABI, provider);

    const [supply, mintCap, paused, totalMinted, totalBurned, circulating] =
      await Promise.all([
        contract.totalSupply(),
        contract.mintCap(),
        contract.paused(),
        contract.totalMinted(),
        contract.totalBurned(),
        contract.circulatingSupply(),
      ]);

    return {
      token,
      chain,
      address,
      totalSupply:      ethers.formatUnits(supply,      6),
      circulatingSupply:ethers.formatUnits(circulating, 6),
      mintCap:          ethers.formatUnits(mintCap,     6),
      totalMinted:      ethers.formatUnits(totalMinted, 6),
      totalBurned:      ethers.formatUnits(totalBurned, 6),
      paused,
      utilizationPct:   mintCap > 0n
        ? ((Number(supply) / Number(mintCap)) * 100).toFixed(2) + '%'
        : '0%',
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
  // Runs every 10 minutes (plus once at startup via onModuleInit). Fetches:
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

  async updateAllLiveOraclePrices() {
    const usdToInr = await this.fetchUsdToInrRate();

    for (const token of ['EGOLD', 'ESLVR']) {
      const usdPerOz = await this.fetchSpotPriceUsdPerOz(StablecoinService.METAL_SYMBOL[token]);
      const inrPerGram = (usdPerOz * usdToInr) / StablecoinService.GRAMS_PER_TROY_OUNCE;

      for (const chain of CHAINS) {
        try {
          await this.pushOraclePriceFromAllOracles(token, chain, inrPerGram);
        } catch (err: any) {
          // One chain misconfigured/unreachable shouldn't block the others
          this.logger.warn(`Oracle push failed [${token}/${chain}]: ${err.message}`);
        }
      }
    }
  }

  private async fetchSpotPriceUsdPerOz(metalSymbol: string): Promise<number> {
    const cacheKey  = `livePrice:${metalSymbol}`;
    const staleKey  = `livePrice:${metalSymbol}:stale`; // long-lived, no short TTL
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return parseFloat(cached);

    try {
      const price = await this.fetchWithRetry(
        async () => {
          const res = await axios.get(`https://api.gold-api.com/price/${metalSymbol}`, { timeout: 10000 });
          const p = Number(res.data?.price);
          if (!p || p <= 0) throw new Error(`Invalid spot price response for ${metalSymbol}`);
          return p;
        },
        `spot price [${metalSymbol}]`,
      );

      // Cache for 4 minutes — cushions against the 5-min cron overlapping a rate limit
      await this.redis.set(cacheKey, price.toString(), 240).catch(() => {});
      // Also keep a long-lived copy purely as an emergency fallback (24h) —
      // used only if a future fetch fails outright (see catch below).
      await this.redis.set(staleKey, price.toString(), 86400).catch(() => {});
      return price;
    } catch (err: any) {
      // Live fetch + retries all failed (e.g. a DNS/network blip). Rather
      // than skip pushing a price for this whole 5-minute cycle, fall back
      // to the last known-good price if we have one recent enough to still
      // be reasonable — better an hour-old gold price than no price update
      // at all. If there's nothing usable, we genuinely have to give up.
      const stale = await this.redis.get(staleKey).catch(() => null);
      if (stale) {
        this.logger.warn(`Spot price fetch failed for ${metalSymbol} (${err.message}) — using last known price as fallback`);
        return parseFloat(stale);
      }
      throw err;
    }
  }

  private async fetchUsdToInrRate(): Promise<number> {
    const cacheKey = 'livePrice:usdInr';
    const staleKey = 'livePrice:usdInr:stale';
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return parseFloat(cached);

    try {
      const rate = await this.fetchWithRetry(
        () => this.fetchUsdToInrPrimary(),
        'USD/INR rate (primary)',
        // On the primary provider's final failure, try a second independent
        // provider before giving up entirely — two providers failing at
        // once is far less likely than one.
        () => this.fetchWithRetry(() => this.fetchUsdToInrFallback(), 'USD/INR rate (fallback)'),
      );

      await this.redis.set(cacheKey, rate.toString(), 240).catch(() => {});
      await this.redis.set(staleKey, rate.toString(), 86400).catch(() => {});
      return rate;
    } catch (err: any) {
      const stale = await this.redis.get(staleKey).catch(() => null);
      if (stale) {
        this.logger.warn(`USD/INR rate fetch failed (${err.message}) — using last known rate as fallback`);
        return parseFloat(stale);
      }
      throw err;
    }
  }

  private async fetchUsdToInrPrimary(): Promise<number> {
    const res  = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 10000 });
    const rate = Number(res.data?.rates?.INR);
    if (!rate || rate <= 0) throw new Error('Invalid USD/INR rate response');
    return rate;
  }

  // frankfurter.app (ECB-backed, free, no key) — only refreshes on ECB
  // business days, so it's a bit less "live" than open.er-api, but that's
  // an acceptable trade-off for an emergency fallback that only kicks in
  // when the primary source is unreachable.
  private async fetchUsdToInrFallback(): Promise<number> {
    const res  = await axios.get('https://api.frankfurter.app/latest?from=USD&to=INR', { timeout: 10000 });
    const rate = Number(res.data?.rates?.INR);
    if (!rate || rate <= 0) throw new Error('Invalid USD/INR fallback rate response');
    return rate;
  }

  // Retries transient network failures (DNS hiccups, timeouts, connection
  // resets, 5xx) a couple of times with a short delay — most outages like
  // the "getaddrinfo EAI_AGAIN" DNS blip are gone within a second or two,
  // so it's worth trying again before falling all the way back to stale
  // cache or a second provider. Non-transient errors (bad response shape,
  // 4xx) fail fast since retrying won't help.
  private async fetchWithRetry<T>(
    fn: () => Promise<T>,
    label: string,
    onExhausted?: () => Promise<T>,
    attempts = 3,
  ): Promise<T> {
    let lastErr: any;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const transient =
          ['EAI_AGAIN', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(err?.code) ||
          (err?.response?.status ?? 0) >= 500;
        if (!transient || i === attempts) break;
        this.logger.debug(`${label} fetch failed (${err.message}), retrying (${i}/${attempts - 1})…`);
        await new Promise(r => setTimeout(r, 1500 * i));
      }
    }
    if (onExhausted) return onExhausted();
    throw lastErr;
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
        const signer = new ethers.Wallet(key, provider);
        const oracle = new ethers.Contract(oracleAddr, ORACLE_ABI, signer);

        // Get current on-chain price
        const [currentPrice] = await oracle.getPriceSafe(tokenId);

        // First update after deployment
        if (currentPrice > 0n) {
          const diff =
            currentPrice > priceScaled
              ? currentPrice - priceScaled
              : priceScaled - currentPrice;

          const percent =
            Number(diff * 10000n / currentPrice) / 100;

          if (percent < 0.5) {
            this.logger.log(
              `[${chain}] Skipping ${token}. Price changed only ${percent.toFixed(2)}%`
            );
            return;
          }
        }

        // Only send transaction if price changed enough
        const tx = await oracle.updatePrice(tokenId, priceScaled);
        const receipt = await tx.wait();

        this.logger.log(
          `[${chain}] Oracle ${i + 1} pushed ${token} (tx ${receipt.hash})`
        );
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
    const address  = this.getTokenAddress(dto.token, dto.chain);
    const provider = this.getProvider(dto.chain);

    // Support either env var name — the old code only read MINTER_PRIVATE_KEY
    // but its error message referenced SIGNER_1_PRIVATE_KEY instead, which
    // made a genuinely-missing key very confusing to diagnose. Falling back
    // to SIGNER_1_PRIVATE_KEY also means one signer key can double as both,
    // if that's how the account is actually configured.
    const minterKey = process.env.MINTER_PRIVATE_KEY ?? process.env.SIGNER_1_PRIVATE_KEY;
    if (!minterKey) {
      throw new BadRequestException('MINTER_PRIVATE_KEY (or SIGNER_1_PRIVATE_KEY) not set — cannot mint directly');
    }

    const signer   = new ethers.Wallet(minterKey, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);
    const paused   = await contract.paused();
    if (paused) throw new BadRequestException(`${dto.token} is paused on ${dto.chain}`);

    const parsed = ethers.parseUnits(dto.amount, 6);

    // IMPORTANT: only await the transaction being *submitted* (tx.hash is
    // available as soon as it's broadcast to the mempool) — NOT full
    // on-chain confirmation (tx.wait()). Waiting for confirmation here
    // regularly took longer than the gateway's 30s proxy timeout, so every
    // mint looked like a 502 "service unavailable" from the gateway even
    // though it actually succeeded on-chain a few seconds later — the
    // request was killed client-side before stablecoin-service could ever
    // respond. This now matches how wallet-service.sendToken() already
    // works: respond PENDING immediately, confirm in the background.
    let tx;
    try {
      tx = await contract.mint(dto.toAddress, parsed, dto.reason);
    } catch (err: any) {
      throw new BadRequestException(
        err?.reason ?? err?.shortMessage ?? err?.message ?? 'Mint transaction failed to submit'
      );
    }

    const wallet = await this.recordTx(
      tx.hash, dto.chain, 'MINT', dto.amount, dto.token, 'treasury', dto.toAddress, requestedBy, 'PENDING'
    );
    this.confirmTxInBackground(tx, wallet?.id, dto.chain, 'MINT');

    this.logger.log(`Mint submitted: ${tx.hash} for ${dto.amount} ${dto.token} to ${dto.toAddress} on ${dto.chain}`);
    return { txHash: tx.hash, status: 'PENDING' };
  }

  // ─── Burn (direct) ─────────────────────────────────────────────────────────

  async burnTokens(dto: BurnDto, requestedBy: string) {
    const address  = this.getTokenAddress(dto.token, dto.chain);
    const provider = this.getProvider(dto.chain);

    const burnerKey = process.env.SIGNER_1_PRIVATE_KEY;
    if (!burnerKey) throw new BadRequestException('SIGNER_1_PRIVATE_KEY not set — cannot burn directly');

    const signer   = new ethers.Wallet(burnerKey, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);
    const parsed   = ethers.parseUnits(dto.amount, 6);

    // Same fix as mintTokens: don't block the HTTP response on tx.wait().
    let tx;
    try {
      tx = await contract.burn(dto.fromAddress, parsed, dto.reason);
    } catch (err: any) {
      throw new BadRequestException(
        err?.reason ?? err?.shortMessage ?? err?.message ?? 'Burn transaction failed to submit'
      );
    }

    const wallet = await this.recordTx(
      tx.hash, dto.chain, 'BURN', dto.amount, dto.token, dto.fromAddress, 'treasury', requestedBy, 'PENDING'
    );
    this.confirmTxInBackground(tx, wallet?.id, dto.chain, 'BURN');

    this.logger.log(`Burn submitted: ${tx.hash} for ${dto.amount} ${dto.token} from ${dto.fromAddress} on ${dto.chain}`);
    return { txHash: tx.hash, status: 'PENDING' };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async recordTx(
    txHash: string, chain: string, type: string, amount: string,
    token: string, from: string, to: string, userId: string,
    status: 'PENDING' | 'CONFIRMED' | 'FAILED' = 'CONFIRMED',
  ) {
    
    const realAddress   = type === 'MINT' ? to : from;
    const matchAddress  = chain === 'tron' ? realAddress : realAddress.toLowerCase();

    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain, address: matchAddress },
    });

    if (!wallet) {
      this.logger.warn(
        `recordTx: no wallet row found for user ${userId} address ${matchAddress} on ${chain} — ` +
        `${type} succeeded on-chain but won't show up in that wallet's transaction history.`
      );
    }

    await Promise.all([
      // Only record Transaction if we found a real wallet
      wallet
        ? this.prisma.transaction.create({
            data: {
              walletId:    wallet.id,
              txHash,
              chain,
              type:        type as TxType,
              amount,
              tokenSymbol: token,
              fromAddress: from,
              toAddress:   to,
              status,
              confirmedAt: status === 'CONFIRMED' ? new Date() : null,
            },
          })
        : Promise.resolve(), // no wallet found — skip DB record, mint/burn still worked

      // Always record audit log
      this.prisma.auditLog.create({
        data: {
          userId,
          action:     `${type}_TOKENS`,
          entityType: 'Token',
          entityId:   txHash,
          payload:    { chain, token, amount, from, to, txHash, status },
        },
      }),
    ]);

    return wallet;
  }

  // Confirms a submitted mint/burn tx in the background, without blocking
  // the HTTP response the caller (gateway) is waiting on. Updates the
  // Transaction row we already created as PENDING to CONFIRMED (or FAILED)
  // once the chain actually finalizes it. This is a fire-and-forget promise
  // chain — errors here are only logged, never thrown, since the HTTP
  // response for the mint/burn request has already been sent.
  private confirmTxInBackground(
    tx: ethers.TransactionResponse,
    walletId: string | undefined,
    chain: string,
    type: string,
  ) {
    if (!walletId) return; // no DB row was created for this tx — nothing to update

    tx.wait()
      .then(async (receipt) => {
        if (!receipt) return;
        await this.prisma.transaction.updateMany({
          where: { walletId, txHash: tx.hash },
          data:  {
            status:      receipt.status === 1 ? 'CONFIRMED' : 'REVERTED',
            confirmedAt: new Date(),
            blockNumber: BigInt(receipt.blockNumber),
            gasUsed:     receipt.gasUsed != null ? receipt.gasUsed.toString() : undefined,
          },
        });
        this.logger.log(`[${chain}] ${type} confirmed: ${tx.hash} (block ${receipt.blockNumber})`);
      })
      .catch(async (err: any) => {
        await this.prisma.transaction.updateMany({
          where: { walletId, txHash: tx.hash },
          data:  { status: 'FAILED' },
        }).catch(() => {});
        this.logger.error(`[${chain}] ${type} failed to confirm: ${tx.hash} — ${err?.message ?? err}`);
      });
  }

  // Same fix as listener.service.ts's getProvider(): this is a separate
  // microservice with its own copy of this logic, so the earlier fix there
  // never applied here. Without an explicit `staticNetwork`, ethers issues
  // its own `eth_chainId` auto-detect call on every request; when the RPC
  // endpoint is unreachable or rejects that call, ethers falls into its
  // built-in "failed to detect network, retry in 1s" loop, which just spams
  // logs forever instead of failing fast. Passing an explicit Network skips
  // that detection entirely. Caching the provider (instead of constructing
  // a new one on every call) also avoids doing that dance repeatedly.
  private readonly EVM_CHAIN_IDS: Record<string, number> = {
    ethereum: 11155111,
    bsc:      97,
    polygon:  80002,
  };

  private evmProviders: Record<string, ethers.JsonRpcProvider> = {};

  private getProvider(chain: string): ethers.JsonRpcProvider {
    if (this.evmProviders[chain]) return this.evmProviders[chain];

    const map: Record<string, string | undefined> = {
      ethereum: process.env.ETH_RPC,
      bsc:      process.env.BSC_RPC,
      polygon:  process.env.POLYGON_RPC,
    };
    const url = map[chain];
    if (!url) throw new BadRequestException(`Unsupported chain: ${chain}`);

    const chainId = this.EVM_CHAIN_IDS[chain];
    const provider = new ethers.JsonRpcProvider(
      url,
      chainId ? ethers.Network.from(chainId) : undefined,
      {
        staticNetwork: chainId ? ethers.Network.from(chainId) : undefined,
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