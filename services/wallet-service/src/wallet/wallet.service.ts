import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KmsService }    from './kms.service';
import { ChainService }  from './chain.service';
import { SendTokenDto }  from './dto/send-token.dto';
import {
  generateMnemonic,
  validateMnemonic,
  deriveAllAddresses,
} from '@ecosystem/crypto';

// Converts BigInt / Decimal fields to string so JSON.stringify never crashes.
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

  // ─── Helper: next available wallet index for a user ────────────────────────

  private async nextWalletIndex(userId: string): Promise<number> {
    const last = await this.prisma.wallet.findFirst({
      where:   { userId },
      orderBy: { walletIndex: 'desc' },
      select:  { walletIndex: true },
    });
    return (last?.walletIndex ?? -1) + 1;
  }   

  // ─── Helper: get active walletIndex for a user ─────────────────────────────
  // Stored as a Redis/DB concept; for simplicity we store in a separate small
  // table. Since we don't have one, we use the lowest walletIndex that exists.
  // The frontend stores the active index in AsyncStorage and sends it as a
  // query param when needed. For the default (no param), we use index 0.

  private async getActiveWalletIndex(userId: string, requestedIndex?: number): Promise<number> {
    const idx = requestedIndex ?? 0;
    const exists = await this.prisma.wallet.findFirst({
      where: { userId, walletIndex: idx },
    });
    if (!exists) {
      // Fall back to index 0
      return 0;
    }
    return idx;
  }

  // ─── Create wallet ───────────────────────────────────────────────────────────
  // Now supports multiple wallets. Each call creates a new wallet with the next
  // available walletIndex for that user.

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

  // ─── Import wallet ───────────────────────────────────────────────────────────

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
  // Returns one entry per wallet (grouped by walletIndex), not one per chain.

  async getWallets(userId: string) {
    const rows = await this.prisma.wallet.findMany({
      where:   { userId },
      select:  { walletIndex: true, label: true, chain: true, address: true, createdAt: true },
      orderBy: [{ walletIndex: 'asc' }, { chain: 'asc' }],
    });

    // Group by walletIndex
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

  // ─── Rename a wallet ──────────────────────────────────────────────────────────

  async renameWallet(userId: string, walletIndex: number, label: string) {
    const count = await this.prisma.wallet.count({
      where: { userId, walletIndex },
    });
    if (!count) throw new NotFoundException(`Wallet ${walletIndex} not found`);

    await this.prisma.wallet.updateMany({
      where: { userId, walletIndex },
      data:  { label },
    });

    return { walletIndex, label };
  }

  // ─── Get addresses ─────────────────────────────────────────────────────────────
  // walletIndex defaults to 0 (first wallet). Frontend passes ?walletIndex=N.

  async getAddresses(userId: string, walletIndex = 0) {
    const wallets = await this.prisma.wallet.findMany({
      where:  { userId, walletIndex },
      select: { chain: true, address: true },
    });
    if (!wallets.length) {
      // Fall back to walletIndex 0 if the requested one doesn't exist
      const fallback = await this.prisma.wallet.findMany({
        where:  { userId, walletIndex: 0 },
        select: { chain: true, address: true },
      });
      if (!fallback.length) throw new NotFoundException('No wallet found');
      return fallback.reduce((acc, w) => { acc[w.chain] = w.address; return acc; }, {} as Record<string, string>);
    }

    return wallets.reduce((acc, w) => { acc[w.chain] = w.address; return acc; }, {} as Record<string, string>);
  }

  // ─── Get all balances ──────────────────────────────────────────────────────────
  // walletIndex defaults to 0.

  async getAllBalances(userId: string, walletIndex = 0) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, walletIndex },
    });
    if (!wallets.length) throw new NotFoundException('No wallet found');

    const tokens  = ['INRX', 'EGOLD', 'ESLVR'];
    const results = [];

    for (const wallet of wallets) {
      for (const symbol of tokens) {
        const tokenAddress = this.chain.getTokenAddress(wallet.chain, symbol);
        if (!tokenAddress) continue;

        const balance = await this.chain.getBalance(wallet.chain, wallet.address, tokenAddress);
        results.push({ chain: wallet.chain, address: wallet.address, symbol, balance, walletIndex });
      }
    }

    return results;
  }

  // ─── Send tokens ───────────────────────────────────────────────────────────────
  // walletIndex specifies which wallet to send from.

  async sendToken(userId: string, dto: SendTokenDto & { walletIndex?: number }) {
    const walletIndex  = dto.walletIndex ?? 0;
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain: dto.chain, walletIndex },
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

  // ─── Transaction history ────────────────────────────────────────────────────────
  // walletIndex = undefined means ALL wallets for this user.

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

  // ─── Get single transaction ─────────────────────────────────────────────────────

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