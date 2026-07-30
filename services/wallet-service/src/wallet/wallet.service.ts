import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { KmsService }    from './kms.service';
import { ChainService }  from './chain.service';
import { SendTokenDto }  from './dto/send-token.dto';
import {
  generateMnemonic,
  validateMnemonic,
  deriveAllAddresses,
} from '@ecosystem/crypto';

function serializeTx(tx: any) {
  return {
    ...tx,
    blockNumber: tx.blockNumber != null ? tx.blockNumber.toString() : null,
    gasUsed:     tx.gasUsed     != null ? tx.gasUsed.toString()     : null,
    amount:      tx.amount      != null ? tx.amount.toString()      : null,
  };
}

const ALL_CHAINS = ['tron', 'ethereum', 'bsc', 'polygon', 'solana'] as const;
type Chain = typeof ALL_CHAINS[number];

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    private kms:    KmsService,
    private chain:  ChainService,
  ) {}

  private async nextWalletIndex(userId: string): Promise<number> {
    const last = await this.prisma.wallet.findFirst({
      where:   { userId },
      orderBy: { walletIndex: 'desc' },
      select:  { walletIndex: true },
    });
    return (last?.walletIndex ?? -1) + 1;
  }

  private async getActiveWalletIndex(userId: string, requestedIndex?: number): Promise<number> {
    const idx = requestedIndex ?? 0;
    const exists = await this.prisma.wallet.findFirst({
      where: { userId, walletIndex: idx },
    });
    if (!exists) {
      return 0;
    }
    return idx;
  }

  async createWallet(userId: string, label?: string) {
    const walletIndex = await this.nextWalletIndex(userId);
    const mnemonic    = generateMnemonic();
    const addresses   = deriveAllAddresses(mnemonic);
    const encrypted   = await this.kms.encrypt(mnemonic);
    const walletLabel = label ?? `Wallet ${walletIndex + 1}`;

    await this.prisma.$transaction(
      ALL_CHAINS.map(c =>
        this.prisma.wallet.create({
          data: {
            userId,
            chain:         c,
            address:       c === 'tron' ? addresses[c] : addresses[c].toLowerCase(),
            encPrivateKey: encrypted,
            walletIndex,
            label:         walletLabel,
          },
        })
      )
    );

    this.logger.log(`Wallet ${walletIndex} (${walletLabel}) created for user ${userId}`);
    return { walletIndex, label: walletLabel, mnemonic, addresses };
  }

  async importWallet(userId: string, mnemonic: string, label?: string) {
    if (!validateMnemonic(mnemonic)) {
      throw new BadRequestException('Invalid mnemonic phrase');
    }

    const addresses   = deriveAllAddresses(mnemonic);
    const encrypted   = await this.kms.encrypt(mnemonic);
    const walletIndex = await this.nextWalletIndex(userId);
    const walletLabel = label ?? `Imported Wallet ${walletIndex + 1}`;

    await this.prisma.$transaction(
      ALL_CHAINS.map(c =>
        this.prisma.wallet.create({
          data: {
            userId,
            chain:         c,
            address:       c === 'tron' ? addresses[c] : addresses[c].toLowerCase(),
            encPrivateKey: encrypted,
            walletIndex,
            label:         walletLabel,
          },
        })
      )
    );

    this.logger.log(`Wallet ${walletIndex} imported for user ${userId}`);
    return { walletIndex, label: walletLabel, addresses };
  }

  // ─── Get all wallets for a user ───────────────────────────────────────────────
  // Only active (non-deleted) wallets are returned.

  async getWallets(userId: string) {
    const rows = await this.prisma.wallet.findMany({
      where:   { userId, isActive: true },
      select:  { walletIndex: true, label: true, chain: true, address: true, createdAt: true },
      orderBy: [{ walletIndex: 'asc' }, { chain: 'asc' }],
    });

    const grouped: Record<number, any> = {};
    for (const row of rows) {
      if (!grouped[row.walletIndex]) {
        grouped[row.walletIndex] = {
          walletIndex: row.walletIndex,
          label:       row.label ?? `Wallet ${row.walletIndex + 1}`,
          createdAt:   row.createdAt,
          addresses:   {} as Record<string, string>,
        };
      }
      grouped[row.walletIndex].addresses[row.chain] = row.address;
    }

    return Object.values(grouped);
  }

  async renameWallet(userId: string, walletIndex: number, label: string) {
    const count = await this.prisma.wallet.count({
      where: { userId, walletIndex, isActive: true },
    });
    if (!count) throw new NotFoundException(`Wallet ${walletIndex} not found`);

    await this.prisma.wallet.updateMany({
      where: { userId, walletIndex, isActive: true },
      data:  { label },
    });

    return { walletIndex, label };
  }

  // ─── Delete a wallet (soft delete) ───────────────────────────────────────────
  // Keeps rows (and transaction history) around, just hides the wallet from
  // the person's list and blocks it from being used going forward. Refuses
  // to delete someone's only remaining wallet — the app always needs at
  // least one wallet to function.

  async deleteWallet(userId: string, walletIndex: number) {
    const existing = await this.prisma.wallet.findFirst({
      where: { userId, walletIndex, isActive: true },
    });
    if (!existing) throw new NotFoundException(`Wallet ${walletIndex} not found`);

    const activeCount = await this.prisma.wallet.groupBy({
      by:    ['walletIndex'],
      where: { userId, isActive: true },
    });
    if (activeCount.length <= 1) {
      throw new BadRequestException('You must keep at least one wallet.');
    }

    await this.prisma.wallet.updateMany({
      where: { userId, walletIndex },
      data:  { isActive: false },
    });

    this.logger.log(`Wallet ${walletIndex} deleted for user ${userId}`);
    return { walletIndex, deleted: true };
  }

  async getAddresses(userId: string, walletIndex = 0) {
    const wallets = await this.prisma.wallet.findMany({
      where:  { userId, walletIndex, isActive: true },
      select: { chain: true, address: true },
    });
    if (!wallets.length) {
      const fallback = await this.prisma.wallet.findMany({
        where:  { userId, walletIndex: 0, isActive: true },
        select: { chain: true, address: true },
      });
      if (!fallback.length) throw new NotFoundException('No wallet found');
      return fallback.reduce((acc, w) => { acc[w.chain] = w.address; return acc; }, {} as Record<string, string>);
    }

    return wallets.reduce((acc, w) => { acc[w.chain] = w.address; return acc; }, {} as Record<string, string>);
  }

  async getAllBalances(userId: string, walletIndex = 0) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, walletIndex, isActive: true },
    });
    if (!wallets.length) throw new NotFoundException('No wallet found');

    const tokens  = ['INRX', 'EGOLD', 'ESLVR'];
    const results = [];
    const prices  = await this.getLivePricesCached();

    for (const wallet of wallets) {
      for (const symbol of tokens) {
        const tokenAddress = this.chain.getTokenAddress(wallet.chain, symbol);
        if (!tokenAddress) continue;

        const balance = await this.chain.getBalance(wallet.chain, wallet.address, tokenAddress);
        const price   = prices?.[symbol];
        results.push({
          chain: wallet.chain, address: wallet.address, symbol, balance, walletIndex,
          // Balance itself is fixed (only mint/burn/send/bridge change it) —
          // these are just its current real-world value at today's rate,
          // computed fresh every call, never stored.
          valueUsd: price ? Number(balance) * price.usd : null,
          valueInr: price ? Number(balance) * price.inr : null,
        });
      }
    }

    return results;
  }

  // Live prices come from stablecoin-service (service-to-service, not
  // through the gateway — this is public market data with no user-specific
  // info, same as what the public dashboard shows). Cached briefly here so
  // a burst of balance checks across many users doesn't hammer that
  // endpoint (which itself caches upstream in Redis) on every request.
  private livePricesCache: { data: any; expiresAt: number } | null = null;
  private async getLivePricesCached(): Promise<Record<string, { usd: number; inr: number }> | null> {
    if (this.livePricesCache && this.livePricesCache.expiresAt > Date.now()) {
      return this.livePricesCache.data;
    }
    try {
      const url = process.env.STABLECOIN_SERVICE_URL ?? 'http://localhost:3005';
      const res = await axios.get(`${url}/stablecoin/live-prices`, { timeout: 8000 });
      const prices = res.data?.prices ?? null;
      this.livePricesCache = { data: prices, expiresAt: Date.now() + 15_000 };
      return prices;
    } catch (err: any) {
      this.logger.warn(`Failed to fetch live prices from stablecoin-service: ${err.message}`);
      // Balances still work without pricing — valueUsd/valueInr just come
      // back null rather than failing the whole balance check.
      return this.livePricesCache?.data ?? null;
    }
  }

  async sendToken(userId: string, dto: SendTokenDto & { walletIndex?: number }) {
    const walletIndex  = dto.walletIndex ?? 0;
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain: dto.chain, walletIndex, isActive: true },
    });
    if (!wallet) throw new NotFoundException(`Wallet ${walletIndex} not found for chain ${dto.chain}`);

    const tokenAddress = this.chain.getTokenAddress(dto.chain, dto.token);
    if (!tokenAddress) throw new BadRequestException('Token not supported on this chain');

    const mnemonic = await this.kms.decrypt(wallet.encPrivateKey);
    let txHash: string;

    if (dto.chain === 'tron') {
      txHash = await this.chain.sendTRONToken(mnemonic, dto.toAddress, tokenAddress, dto.amount);
    } else {
      txHash = await this.chain.sendEVMToken(dto.chain, mnemonic, dto.toAddress, tokenAddress, dto.amount);
    }

    await this.prisma.transaction.create({
      data: {
        walletId:    wallet.id,
        txHash,
        chain:       dto.chain,
        type:        'SEND',
        amount:      dto.amount,
        tokenSymbol: dto.token,
        fromAddress: wallet.address,
        toAddress:   dto.chain === 'tron' ? dto.toAddress : dto.toAddress.toLowerCase(),
        status:      'PENDING',
      },
    });

    this.logger.log(`[wallet ${walletIndex}] Token sent: ${txHash} on ${dto.chain}`);
    return { txHash, status: 'PENDING', walletIndex };
  }

  async getTransactions(userId: string, page = 1, limit = 20, walletIndex?: number) {
    const walletWhere: any = { userId };
    if (walletIndex !== undefined) walletWhere.walletIndex = walletIndex;

    const wallets = await this.prisma.wallet.findMany({
      where:  walletWhere,
      select: { id: true },
    });
    const walletIds = wallets.map(w => w.id);

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where:   { walletId: { in: walletIds } },
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      this.prisma.transaction.count({
        where: { walletId: { in: walletIds } },
      }),
    ]);

    return { data: data.map(serializeTx), total, page, limit };
  }

  async getTransaction(userId: string, txId: string) {
    const wallets   = await this.prisma.wallet.findMany({
      where:  { userId },
      select: { id: true },
    });
    const walletIds = wallets.map(w => w.id);

    const tx = await this.prisma.transaction.findFirst({
      where: { id: txId, walletId: { in: walletIds } },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    return serializeTx(tx);
  }
}