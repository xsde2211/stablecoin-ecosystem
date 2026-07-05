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
    this.updateAllLiveOraclePrices().catch(err =>
      this.logger.error(`Initial live price push failed: ${err.message}`)
    );
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

  @Cron(CronExpression.EVERY_5_MINUTES)
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
    const cacheKey = `livePrice:${metalSymbol}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return parseFloat(cached);

    const res = await axios.get(`https://api.gold-api.com/price/${metalSymbol}`, { timeout: 10000 });
    const price = Number(res.data?.price);
    if (!price || price <= 0) throw new Error(`Invalid spot price response for ${metalSymbol}`);

    // Cache for 4 minutes — cushions against the 5-min cron overlapping a rate limit
    await this.redis.set(cacheKey, price.toString(), 240).catch(() => {});
    return price;
  }

  private async fetchUsdToInrRate(): Promise<number> {
    const cacheKey = 'livePrice:usdInr';
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return parseFloat(cached);

    const res  = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 10000 });
    const rate = Number(res.data?.rates?.INR);
    if (!rate || rate <= 0) throw new Error('Invalid USD/INR rate response');

    await this.redis.set(cacheKey, rate.toString(), 240).catch(() => {});
    return rate;
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
    const address  = this.getTokenAddress(dto.token, dto.chain);
    const provider = this.getProvider(dto.chain);

    const burnerKey = process.env.SIGNER_1_PRIVATE_KEY;
    if (!burnerKey) throw new BadRequestException('SIGNER_1_PRIVATE_KEY not set — cannot burn directly');

    const signer   = new ethers.Wallet(burnerKey, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);
    const parsed   = ethers.parseUnits(dto.amount, 6);
    const tx       = await contract.burn(dto.fromAddress, parsed, dto.reason);
    const receipt  = await tx.wait();

    await this.recordTx(receipt.hash, dto.chain, 'BURN', dto.amount, dto.token, dto.fromAddress, 'treasury', requestedBy);
    this.logger.log(`Burned ${dto.amount} ${dto.token} from ${dto.fromAddress} on ${dto.chain}`);
    return { txHash:receipt.hash, status:'CONFIRMED' };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async recordTx(
    txHash: string, chain: string, type: string, amount: string,
    token: string, from: string, to: string, userId: string,
  ) {
    // Look up the user's actual wallet for this chain
    // If not found, skip transaction recording (mint still succeeded on-chain)
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain },
    });

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
              status:      'CONFIRMED',
              confirmedAt: new Date(),
            },
          })
        : Promise.resolve(), // no wallet found — skip DB record, mint still worked

      // Always record audit log
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

  private getProvider(chain: string): ethers.JsonRpcProvider {
    const map: Record<string,string> = {
      ethereum: process.env.ETH_RPC!,
      bsc:      process.env.BSC_RPC!,
      polygon:  process.env.POLYGON_RPC!,
    };
    if (!map[chain]) throw new BadRequestException(`Unsupported chain: ${chain}`);
    return new ethers.JsonRpcProvider(map[chain]);
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