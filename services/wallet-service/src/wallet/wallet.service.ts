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

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma:  PrismaService,
    private kms:     KmsService,
    private chain:   ChainService,
  ) {}

  // ─── Create wallet ───────────────────────────────────────────────

  async createWallet(userId: string) {
    // Check user doesn't already have a wallet
    const existing = await this.prisma.wallet.findFirst({
      where: { userId, chain: 'tron' },
    });
    if (existing) throw new BadRequestException('Wallet already exists for this user');

    const mnemonic  = generateMnemonic();
    const addresses = deriveAllAddresses(mnemonic);
    const encrypted = await this.kms.encrypt(mnemonic);

    const chains = ['tron', 'ethereum', 'bsc', 'polygon', 'solana'] as const;

    await this.prisma.$transaction(
      chains.map(c =>
        this.prisma.wallet.create({
          data: {
            userId,
            chain:        c,
            address:      addresses[c],
            encPrivateKey: encrypted,
          },
        })
      )
    );

    this.logger.log(`Wallet created for user ${userId}`);

    // IMPORTANT: mnemonic shown once here, never again
    return { mnemonic, addresses };
  }

  // ─── Import wallet ───────────────────────────────────────────────

  async importWallet(userId: string, mnemonic: string) {
    if (!validateMnemonic(mnemonic)) {
      throw new BadRequestException('Invalid mnemonic phrase');
    }

    const addresses = deriveAllAddresses(mnemonic);
    const encrypted = await this.kms.encrypt(mnemonic);
    const chains    = ['tron', 'ethereum', 'bsc', 'polygon', 'solana'] as const;

    for (const c of chains) {
      await this.prisma.wallet.upsert({
        where:  { userId_chain: { userId, chain: c } },
        update: { address: addresses[c], encPrivateKey: encrypted },
        create: { userId, chain: c, address: addresses[c], encPrivateKey: encrypted },
      });
    }

    return { addresses };
  }

  // ─── Get addresses ───────────────────────────────────────────────

  async getAddresses(userId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where:  { userId },
      select: { chain: true, address: true },
    });
    if (!wallets.length) throw new NotFoundException('No wallet found');

    return wallets.reduce((acc, w) => {
      acc[w.chain] = w.address;
      return acc;
    }, {} as Record<string, string>);
  }

  // ─── Get all balances ────────────────────────────────────────────

  async getAllBalances(userId: string) {
    const wallets = await this.prisma.wallet.findMany({ where: { userId } });
    if (!wallets.length) throw new NotFoundException('No wallet found');

    const tokens  = ['INRX', 'EGOLD', 'ESLVR'];
    const results = [];

    for (const wallet of wallets) {
      for (const symbol of tokens) {
        const tokenAddress = this.chain.getTokenAddress(wallet.chain, symbol);
        if (!tokenAddress) continue;

        const balance = await this.chain.getBalance(
          wallet.chain,
          wallet.address,
          tokenAddress,
        );

        results.push({
          chain:   wallet.chain,
          address: wallet.address,
          symbol,
          balance,
        });
      }
    }

    return results;
  }

  // ─── Send tokens ─────────────────────────────────────────────────

  async sendToken(userId: string, dto: SendTokenDto) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_chain: { userId, chain: dto.chain } },
    });
    if (!wallet) throw new NotFoundException('Wallet not found for this chain');

    const tokenAddress = this.chain.getTokenAddress(dto.chain, dto.token);
    if (!tokenAddress) throw new BadRequestException('Token not supported on this chain');

    const mnemonic = await this.kms.decrypt(wallet.encPrivateKey);

    let txHash: string;

    if (dto.chain === 'tron') {
      txHash = await this.chain.sendTRONToken(
        mnemonic, dto.toAddress, tokenAddress, dto.amount,
      );
    } else {
      txHash = await this.chain.sendEVMToken(
        dto.chain, mnemonic, dto.toAddress, tokenAddress, dto.amount,
      );
    }

    // Record transaction
    await this.prisma.transaction.create({
      data: {
        walletId:    wallet.id,
        txHash,
        chain:       dto.chain,
        type:        'SEND',
        amount:      dto.amount,
        tokenSymbol: dto.token,
        fromAddress: wallet.address,
        toAddress:   dto.toAddress,
        status:      'PENDING',
      },
    });

    this.logger.log(`Token sent: ${txHash} on ${dto.chain}`);
    return { txHash, status: 'PENDING' };
  }

  // ─── Transaction history ─────────────────────────────────────────

  async getTransactions(userId: string, page = 1, limit = 20) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
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

    return { data, total, page, limit };
  }
}