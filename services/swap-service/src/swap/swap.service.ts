import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import axios          from 'axios';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import { PriceService }  from './price.service';
import { QuoteDto }      from './dto/quote.dto';
import {
  SWAP_NETWORKS, SWAP_TOKENS, findNetwork, isSwapToken,
} from './network-registry';

const WALLET_SERVICE_URL     = () => process.env.WALLET_SERVICE_URL     ?? 'http://localhost:3003';
const STABLECOIN_SERVICE_URL = () => process.env.STABLECOIN_SERVICE_URL ?? 'http://localhost:3005';

// Fee taken off the source side of every swap, in basis points (30 = 0.30%).
// Since both tokens are burned/minted by us rather than pulled from a
// liquidity pool, the fee doesn't need to go anywhere — it's just how much
// less of toToken gets minted than a 0%-fee conversion would produce.
const DEFAULT_FEE_BPS = 30;

// Quote validity window — long enough to review and confirm, short enough
// that gold/silver/INR market moves in that window stay negligible.
const QUOTE_TTL_MS = 30_000;

interface StoredQuote {
  userId:      string;
  walletIndex: number;
  network:     string;
  fromToken:   string;
  toToken:     string;
  amount:      string;
  toAmount:    string;
  feeBps:      number;
  feeUsd:      number;
  createdAt:   number;
  expiresAt:   number;
}

// Prisma returns blockNumber/gasUsed as native BigInt (SQL BigInt columns) —
// JSON.stringify can't serialize those and throws "Do not know how to
// serialize a BigInt". Matters here specifically because upsert()'s update
// branch below only touches the fields listed in burnData/mintData — it
// never clears blockNumber, so if listener-service already wrote this row
// first (it sets a real blockNumber from the Transfer event), that BigInt
// survives the upsert untouched and would still crash getHistory() without
// this. Same fix wallet-service's wallet.service.ts already applies via its
// own serializeTx() for the same reason.
function serializeTx(tx: any) {
  return {
    ...tx,
    blockNumber: tx.blockNumber != null ? tx.blockNumber.toString() : null,
    gasUsed:     tx.gasUsed     != null ? tx.gasUsed.toString()     : null,
    amount:      tx.amount      != null ? tx.amount.toString()      : null,
  };
}

@Injectable()
export class SwapService {
  private readonly logger = new Logger(SwapService.name);

  constructor(
    private prisma: PrismaService,
    private redis:  RedisService,
    private prices: PriceService,
  ) {}

  // ─── Static lists — for the mobile app's network/token pickers ───────────

  listNetworks() { return SWAP_NETWORKS; }
  listTokens()   { return SWAP_TOKENS; }

  // ─── Quote ─────────────────────────────────────────────────────────────────

  async quote(dto: QuoteDto, userId: string) {
    const network = findNetwork(dto.network);
    if (!network) throw new BadRequestException(`Unknown network: ${dto.network}`);
    if (!network.deployed) {
      throw new BadRequestException(network.note ?? `Swaps aren't available on ${network.label} yet`);
    }

    const fromToken = dto.fromToken.toUpperCase();
    const toToken   = dto.toToken.toUpperCase();
    if (!isSwapToken(fromToken)) throw new BadRequestException(`Unknown token: ${dto.fromToken}`);
    if (!isSwapToken(toToken))   throw new BadRequestException(`Unknown token: ${dto.toToken}`);
    if (fromToken === toToken)   throw new BadRequestException('fromToken and toToken must be different');

    const amount = parseFloat(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('amount must be greater than 0');

    const prices = await this.prices.getStablecoinPrices();
    const fromPriceUsd = prices[fromToken]?.usd;
    const toPriceUsd   = prices[toToken]?.usd;
    if (!fromPriceUsd || !toPriceUsd) throw new BadRequestException('Live price unavailable for one of these tokens right now');

    const feeBps       = parseInt(process.env.SWAP_FEE_BPS ?? '', 10) || DEFAULT_FEE_BPS;
    const fromValueUsd = amount * fromPriceUsd;
    const feeUsd       = fromValueUsd * (feeBps / 10_000);
    const netValueUsd  = fromValueUsd - feeUsd;
    if (netValueUsd <= 0) throw new BadRequestException('Amount too small to cover the swap fee');

    const toAmount = netValueUsd / toPriceUsd;

    const quoteId = randomUUID();
    const now     = Date.now();
    const stored: StoredQuote = {
      userId,
      walletIndex: dto.walletIndex ?? 0,
      network: network.id, fromToken, toToken,
      amount:   dto.amount,
      toAmount: toAmount.toFixed(6),
      feeBps, feeUsd,
      createdAt: now,
      expiresAt: now + QUOTE_TTL_MS,
    };
    await this.redis.set(`swap:quote:${quoteId}`, JSON.stringify(stored), 60);

    return {
      quoteId,
      network: network.id,
      from: { token: fromToken, amount: dto.amount,      priceUsd: fromPriceUsd },
      to:   { token: toToken,   amount: stored.toAmount,  priceUsd: toPriceUsd },
      rate:      (toAmount / amount).toFixed(8),
      feeBps,
      feeUsd:    feeUsd.toFixed(4),
      expiresAt: new Date(stored.expiresAt).toISOString(),
    };
  }

  // ─── Execute ─────────────────────────────────────────────────────────────

  async execute(quoteId: string, userId: string, authHeader: string) {
    const raw = await this.redis.get(`swap:quote:${quoteId}`);
    if (!raw) throw new NotFoundException('Quote not found or expired — request a new one');
    const q: StoredQuote = JSON.parse(raw);

    if (q.userId !== userId) throw new BadRequestException('This quote belongs to a different user');
    if (Date.now() > q.expiresAt) throw new BadRequestException('Quote expired — request a new one');

    const address = await this.getUserAddress(userId, q.walletIndex, q.network, authHeader);

    this.logger.log(
      `Executing swap ${quoteId}: ${q.amount} ${q.fromToken} -> ${q.toAmount} ${q.toToken} on ${q.network} for user ${userId}`,
    );

    // Burn first, then mint — if the mint leg somehow failed after a
    // successful burn, the user's funds are recoverable manually (the burn
    // is fully audited below with everything needed to replay the mint);
    // this is the same tradeoff any burn-then-mint bridge/conversion makes
    // without a two-phase commit across two independent chain calls.
    const burn = await this.burnStablecoin(q.fromToken, q.network, address, q.amount, authHeader);
    const mint = await this.mintStablecoin(q.toToken,   q.network, address, q.toAmount, authHeader);

    await this.recordSwap(userId, q, address, burn, mint);
    await this.redis.del(`swap:quote:${quoteId}`);

    return {
      status: 'CONFIRMED',
      network: q.network,
      from: { token: q.fromToken, amount: q.amount,   txHash: burn.txHash },
      to:   { token: q.toToken,   amount: q.toAmount, txHash: mint.txHash },
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async getUserAddress(userId: string, walletIndex: number, network: string, authHeader: string): Promise<string> {
    const res = await axios.get(`${WALLET_SERVICE_URL()}/wallet/addresses`, {
      params:  { walletIndex },
      headers: { Authorization: authHeader },
      timeout: 15_000,
    });
    const address = res.data?.[network];
    if (!address) throw new BadRequestException(`No wallet address on ${network} for this user`);
    return address;
  }

  private async burnStablecoin(token: string, network: string, fromAddress: string, amount: string, authHeader: string) {
    const res = await axios.post(
      `${STABLECOIN_SERVICE_URL()}/stablecoin/burn`,
      { token, chain: network, fromAddress, amount, reason: 'swap' },
      { headers: { Authorization: authHeader }, timeout: 120_000 },
    );
    return res.data; // { txHash, status, blockNumber?, feeAmount?, feeSymbol? }
  }

  private async mintStablecoin(token: string, network: string, toAddress: string, amount: string, authHeader: string) {
    const res = await axios.post(
      `${STABLECOIN_SERVICE_URL()}/stablecoin/mint`,
      { token, chain: network, toAddress, amount, reason: 'swap' },
      { headers: { Authorization: authHeader }, timeout: 120_000 },
    );
    return res.data; // { txHash, status, blockNumber?, feeAmount?, feeSymbol? }
  }

  // ─── Recording — same shared Wallet/Transaction model every service uses ──

  private async recordSwap(userId: string, q: StoredQuote, address: string, burn: any, mint: any) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain: q.network, walletIndex: q.walletIndex },
    });
    if (!wallet) return; // addresses came back fine above, so this shouldn't happen — but never block a completed swap on bookkeeping

    const baseMetadata = { network: q.network, feeBps: q.feeBps, feeUsd: q.feeUsd };

    // listener-service watches the chain directly and can insert its own
    // Transaction row for this same (walletId, txHash) before we get here —
    // usually tagged type 'RECEIVE'/'SEND' from the raw Transfer event, not
    // 'SWAP'. Using upsert() (instead of create().catch(P2002)) means that
    // race is handled without Prisma ever throwing internally — a caught
    // exception still gets logged by Prisma's own query logger regardless
    // of what you do with it in JS afterward, which is what was spamming
    // "prisma:error ... Unique constraint failed" into the logs on every
    // swap even though the code recovered correctly. upsert() just runs
    // the update branch directly on conflict — nothing to catch, nothing
    // to log. It still corrects listener-service's row to type SWAP so
    // getHistory()'s `type: 'SWAP'` filter picks it up.
    const burnData = {
      chain: q.network, type: 'SWAP' as const,
      amount: q.amount, tokenSymbol: q.fromToken,
      fromAddress: address, toAddress: 'swap-conversion', status: 'CONFIRMED' as const,
      confirmedAt: new Date(),
      ...(burn.blockNumber != null ? { blockNumber: BigInt(burn.blockNumber) } : {}),
      metadata: {
        ...baseMetadata, direction: 'OUT', counterpart: { token: q.toToken, amount: q.toAmount },
        ...(burn.feeAmount != null ? { feeAmount: burn.feeAmount, feeSymbol: burn.feeSymbol } : {}),
      },
    };
    const mintData = {
      chain: q.network, type: 'SWAP' as const,
      amount: q.toAmount, tokenSymbol: q.toToken,
      fromAddress: 'swap-conversion', toAddress: address, status: 'CONFIRMED' as const,
      confirmedAt: new Date(),
      ...(mint.blockNumber != null ? { blockNumber: BigInt(mint.blockNumber) } : {}),
      metadata: {
        ...baseMetadata, direction: 'IN', counterpart: { token: q.fromToken, amount: q.amount },
        ...(mint.feeAmount != null ? { feeAmount: mint.feeAmount, feeSymbol: mint.feeSymbol } : {}),
      },
    };

    await Promise.all([
      this.prisma.transaction.upsert({
        where:  { walletId_txHash: { walletId: wallet.id, txHash: burn.txHash } },
        create: { walletId: wallet.id, txHash: burn.txHash, ...burnData },
        update: burnData,
      }),
      this.prisma.transaction.upsert({
        where:  { walletId_txHash: { walletId: wallet.id, txHash: mint.txHash } },
        create: { walletId: wallet.id, txHash: mint.txHash, ...mintData },
        update: mintData,
      }),
      this.prisma.auditLog.create({
        data: {
          userId, action: 'SWAP', entityType: 'Swap', entityId: burn.txHash,
          payload: {
            network: q.network,
            from: { token: q.fromToken, amount: q.amount, txHash: burn.txHash },
            to:   { token: q.toToken,   amount: q.toAmount, txHash: mint.txHash },
            feeBps: q.feeBps, feeUsd: q.feeUsd,
          },
        },
      }),
    ]);
  }

  // ─── History ─────────────────────────────────────────────────────────────

  async getHistory(userId: string, page = 1, limit = 20, walletIndex?: number) {
    const walletWhere: any = { userId };
    if (walletIndex !== undefined) walletWhere.walletIndex = walletIndex;

    const wallets   = await this.prisma.wallet.findMany({ where: walletWhere, select: { id: true } });
    const walletIds = wallets.map(w => w.id);

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where:   { walletId: { in: walletIds }, type: 'SWAP' },
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      this.prisma.transaction.count({ where: { walletId: { in: walletIds }, type: 'SWAP' } }),
    ]);

    return { data: data.map(serializeTx), total, page, limit };
  }
}