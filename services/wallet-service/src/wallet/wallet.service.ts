import {
  Injectable, BadRequestException,
  NotFoundException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KmsService }    from './kms.service';
import { ChainService }  from './chain.service';
import { SendTokenDto }  from './dto/send-token.dto';
import * as bip39        from 'bip39';
import { ethers }        from 'ethers';
import { TronWeb }       from 'tronweb';

const CHAINS = ['tron','ethereum','bsc','polygon','solana'] as const;
type Chain   = typeof CHAINS[number];

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    private kms:    KmsService,
    private chain:  ChainService,
  ) {}

  // ─── Create wallet ──────────────────────────────────────────────────────────

  async createWallet(userId: string) {
    const existing = await this.prisma.wallet.findFirst({
      where: { userId, chain: 'tron' },
    });
    if (existing) throw new BadRequestException('Wallet already exists for this user');

    // Generate BIP39 mnemonic (24 words)
    const mnemonic  = bip39.generateMnemonic(256);
    const addresses = this.deriveAllAddresses(mnemonic);
    const encrypted = await this.kms.encrypt(mnemonic);

    // Create wallet records for all chains in a single transaction
    await this.prisma.$transaction(
      CHAINS.map(c =>
        this.prisma.wallet.create({
          data: {
            userId,
            chain:         c,
            address:       addresses[c],
            encPrivateKey: encrypted,
          },
        })
      )
    );

    this.logger.log(`Wallet created for user ${userId}`);

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId,
        action:     'WALLET_CREATE',
        entityType: 'Wallet',
        entityId:   userId,
      },
    });

    // Mnemonic shown ONCE here — never stored in plain text
    return { mnemonic, addresses };
  }

  // ─── Import wallet ──────────────────────────────────────────────────────────

  async importWallet(userId: string, mnemonic: string) {
    const clean = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!bip39.validateMnemonic(clean)) {
      throw new BadRequestException('Invalid mnemonic phrase — must be 12 or 24 valid BIP39 words');
    }

    const addresses = this.deriveAllAddresses(clean);
    const encrypted = await this.kms.encrypt(clean);

    for (const c of CHAINS) {
      await this.prisma.wallet.upsert({
        where:  { userId_chain: { userId, chain: c } },
        update: { address: addresses[c], encPrivateKey: encrypted },
        create: { userId, chain: c, address: addresses[c], encPrivateKey: encrypted },
      });
    }

    this.logger.log(`Wallet imported for user ${userId}`);
    return { addresses };
  }

  // ─── Get all addresses ──────────────────────────────────────────────────────

  async getAddresses(userId: string): Promise<Record<string, string>> {
    const wallets = await this.prisma.wallet.findMany({
      where:  { userId },
      select: { chain: true, address: true },
    });
    if (!wallets.length) throw new NotFoundException('No wallet found. Create or import one first.');

    return wallets.reduce((acc, w) => {
      acc[w.chain] = w.address;
      return acc;
    }, {} as Record<string, string>);
  }

  // ─── Get all balances ────────────────────────────────────────────────────────

  async getAllBalances(userId: string) {
    const wallets = await this.prisma.wallet.findMany({ where: { userId } });
    if (!wallets.length) throw new NotFoundException('No wallet found.');

    const tokens  = ['INRX', 'EGOLD', 'ESLVR'] as const;
    const results = [];

    // Fetch balances in parallel per chain
    const promises = wallets.flatMap(wallet =>
      tokens.map(async symbol => {
        const tokenAddress = this.chain.getTokenAddress(wallet.chain, symbol);
        if (!tokenAddress) return null;

        const balance = await this.chain.getBalance(
          wallet.chain,
          wallet.address,
          tokenAddress,
        );

        return {
          chain:        wallet.chain,
          address:      wallet.address,
          symbol,
          balance,
          tokenAddress,
        };
      })
    );

    const settled = await Promise.allSettled(promises);
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }

    return results;
  }

  // ─── Send tokens ─────────────────────────────────────────────────────────────

  async sendToken(userId: string, dto: SendTokenDto) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_chain: { userId, chain: dto.chain } },
    });
    if (!wallet) throw new NotFoundException(`No wallet for chain: ${dto.chain}`);

    const tokenAddress = this.chain.getTokenAddress(dto.chain, dto.token);
    if (!tokenAddress) {
      throw new BadRequestException(`Token ${dto.token} not configured for chain ${dto.chain}`);
    }

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

    // Record as PENDING — listener service will confirm
    const tx = await this.prisma.transaction.create({
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

    this.logger.log(`Token sent: ${txHash} on ${dto.chain} by user ${userId}`);

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId,
        action:     'TOKEN_SEND',
        entityType: 'Transaction',
        entityId:   tx.id,
        payload:    { chain: dto.chain, token: dto.token, amount: dto.amount, to: dto.toAddress },
      },
    });

    return { txHash, status: 'PENDING', transactionId: tx.id };
  }

  // ─── Transaction history ─────────────────────────────────────────────────────

  async getTransactions(userId: string, page = 1, limit = 20) {
    const wallets = await this.prisma.wallet.findMany({
      where:  { userId },
      select: { id: true },
    });
    const walletIds = wallets.map(w => w.id);

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where:   { walletId: { in: walletIds } },
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
      }),
      this.prisma.transaction.count({
        where: { walletId: { in: walletIds } },
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── Get single transaction ──────────────────────────────────────────────────

  async getTransaction(userId: string, txId: string) {
    const wallets   = await this.prisma.wallet.findMany({ where:{ userId }, select:{ id:true } });
    const walletIds = wallets.map(w => w.id);

    const tx = await this.prisma.transaction.findFirst({
      where: { id: txId, walletId: { in: walletIds } },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  // ─── Address derivation ──────────────────────────────────────────────────────

  private deriveAllAddresses(mnemonic: string): Record<Chain, string> {
    // EVM chains all use the same address (BIP44 m/44'/60'/0'/0/0)
    const evmWallet   = ethers.HDNodeWallet.fromPhrase(mnemonic);
    const evmAddress  = evmWallet.address;

    // TRON: same derivation path but address format differs
    const tronWeb     = new TronWeb({ fullHost: process.env.TRON_RPC! });
    const tronAddress = tronWeb.address.fromPrivateKey(evmWallet.privateKey.slice(2)) as string;

    // Solana: BIP44 m/44'/501'/0'/0' — derive from seed
    const seed        = bip39.mnemonicToSeedSync(mnemonic);
    // Simple derivation — in production use @solana/web3.js Keypair.fromSeed
    const solanaKey   = seed.slice(0, 32);
    const solanaAddr  = Buffer.from(solanaKey).toString('hex'); // placeholder — real impl uses ed25519

    return {
      ethereum: evmAddress,
      bsc:      evmAddress,
      polygon:  evmAddress,
      tron:     tronAddress,
      solana:   solanaAddr,
    };
  }
}
