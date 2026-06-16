import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import { ScoreDto }      from './dto/score.dto';
import { BlacklistDto }  from './dto/blacklist.dto';
import { ResolveFlagDto} from './dto/resolve-flag.dto';

// Risk thresholds (configurable via env)
const HIGH_VALUE_THRESHOLD     = 500000;   // INRX equivalent — single tx over this is flagged
const VELOCITY_WINDOW_MINUTES  = 60;
const VELOCITY_TX_THRESHOLD    = 10;       // more than 10 tx in window = flagged
const VELOCITY_AMOUNT_THRESHOLD= 1000000;  // total amount in window

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  // ─── Score a transaction/action for fraud risk ─────────────────────────────

  async score(dto: ScoreDto) {
    const amount = parseFloat(dto.amount);
    const flags: string[] = [];
    let riskScore = 0;

    // 1. High value check
    if (amount >= HIGH_VALUE_THRESHOLD) {
      flags.push('HIGH_VALUE_TRANSACTION');
      riskScore += 30;
    }

    // 2. Blacklist check on destination address
    if (dto.toAddress) {
      const blacklisted = await this.isBlacklisted(dto.toAddress);
      if (blacklisted) {
        flags.push('DESTINATION_BLACKLISTED');
        riskScore += 100; // automatic max risk
      }
    }

    // 3. Velocity check — recent transactions by this user
    const since = new Date(Date.now() - VELOCITY_WINDOW_MINUTES * 60 * 1000);
    const wallets = await this.prisma.wallet.findMany({ where:{ userId:dto.userId }, select:{ id:true } });
    const walletIds = wallets.map(w => w.id);

    const recentTxs = await this.prisma.transaction.findMany({
      where: { walletId:{ in:walletIds }, createdAt:{ gte:since } },
      select:{ amount:true },
    });

    if (recentTxs.length >= VELOCITY_TX_THRESHOLD) {
      flags.push('HIGH_VELOCITY_TX_COUNT');
      riskScore += 25;
    }

    const recentTotal = recentTxs.reduce((s,t)=>s+parseFloat(t.amount.toString()),0) + amount;
    if (recentTotal >= VELOCITY_AMOUNT_THRESHOLD) {
      flags.push('HIGH_VELOCITY_AMOUNT');
      riskScore += 25;
    }

    // 4. New account check (account created < 24h ago doing large tx)
    const user = await this.prisma.user.findUnique({ where:{ id:dto.userId }, select:{ createdAt:true, kycStatus:true } });
    if (user) {
      const accountAgeHours = (Date.now() - user.createdAt.getTime()) / (1000*60*60);
      if (accountAgeHours < 24 && amount >= 50000) {
        flags.push('NEW_ACCOUNT_LARGE_TX');
        riskScore += 20;
      }
      // 5. KYC status check
      if (user.kycStatus !== 'APPROVED' && amount >= 10000) {
        flags.push('UNVERIFIED_USER_LARGE_TX');
        riskScore += 15;
      }
    }

    riskScore = Math.min(riskScore, 100);
    const riskLevel = riskScore >= 70 ? 'HIGH' : riskScore >= 30 ? 'MEDIUM' : 'LOW';
    const action     = riskScore >= 70 ? 'BLOCK' : riskScore >= 30 ? 'REVIEW' : 'ALLOW';

    // Create a flag record if risk is medium+
    let flagId: string | undefined;
    if (riskScore >= 30) {
      const flag = await this.prisma.fraudFlag.create({
        data: {
          userId:     dto.userId,
          actionType: dto.actionType,
          amount:     dto.amount,
          token:      dto.token,
          toAddress:  dto.toAddress,
          chain:      dto.chain,
          riskScore,
          flags:      flags.join(','),
          status:     'PENDING',
        },
      }).catch(() => null);
      flagId = flag?.id;
    }

    this.logger.log(`Fraud score: user=${dto.userId} score=${riskScore} action=${action} flags=[${flags.join(',')}]`);

    return { riskScore, riskLevel, action, flags, flagId };
  }

  // ─── Get flags (admin review queue) ────────────────────────────────────────

  async getFlags(page=1, limit=20, status?: string) {
    const where: any = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.fraudFlag.findMany({
        where, orderBy:{ createdAt:'desc' }, skip:(page-1)*limit, take:limit,
        include:{ user:{ select:{ email:true, kycStatus:true } } },
      }),
      this.prisma.fraudFlag.count({ where }),
    ]);
    return { data, total, page, limit, totalPages:Math.ceil(total/limit) };
  }

  // ─── Resolve a flag ─────────────────────────────────────────────────────────

  async resolveFlag(flagId: string, dto: ResolveFlagDto, resolvedBy: string) {
    const flag = await this.prisma.fraudFlag.findUnique({ where:{ id:flagId } });
    if (!flag) throw new NotFoundException('Flag not found');

    const updated = await this.prisma.fraudFlag.update({
      where: { id:flagId },
      data:  { status:dto.resolution, resolutionNotes:dto.notes, resolvedBy, resolvedAt:new Date() },
    });

    // If confirmed fraud, auto-suspend user
    if (dto.resolution === 'CONFIRMED_FRAUD') {
      await this.prisma.user.update({ where:{ id:flag.userId }, data:{ isActive:false } });
      await this.prisma.auditLog.create({
        data: { userId:resolvedBy, action:'USER_SUSPEND_FRAUD', entityType:'User', entityId:flag.userId,
                payload:{ flagId, notes:dto.notes } },
      });
      this.logger.warn(`User ${flag.userId} suspended due to confirmed fraud (flag ${flagId})`);
    }

    return updated;
  }

  // ─── Blacklist address ────────────────────────────────────────────────────────

  async addToBlacklist(dto: BlacklistDto, addedBy: string) {
    const entry = await this.prisma.blacklistedAddress.upsert({
      where:  { address_chain: { address:dto.address.toLowerCase(), chain:dto.chain } },
      create: { address:dto.address.toLowerCase(), chain:dto.chain, reason:dto.reason, addedBy },
      update: { reason:dto.reason, addedBy, active:true },
    });

    await this.redis.set(`blacklist:addr:${dto.chain}:${dto.address.toLowerCase()}`, '1', 0);

    await this.prisma.auditLog.create({
      data: { userId:addedBy, action:'BLACKLIST_ADDRESS', entityType:'BlacklistedAddress', entityId:entry.id,
              payload:{ address:dto.address, chain:dto.chain, reason:dto.reason } },
    });

    this.logger.log(`Address blacklisted: ${dto.address} on ${dto.chain}`);
    return entry;
  }

  async isBlacklisted(address: string, chain?: string): Promise<boolean> {
    const where: any = { address: address.toLowerCase(), active:true };
    if (chain) where.chain = chain;
    const found = await this.prisma.blacklistedAddress.findFirst({ where });
    return !!found;
  }

  async getBlacklist(page=1, limit=50) {
    const [data, total] = await Promise.all([
      this.prisma.blacklistedAddress.findMany({
        where: { active:true }, orderBy:{ createdAt:'desc' },
        skip:(page-1)*limit, take:limit,
      }),
      this.prisma.blacklistedAddress.count({ where:{ active:true } }),
    ]);
    return { data, total, page, limit, totalPages:Math.ceil(total/limit) };
  }

  // ─── Fraud stats ──────────────────────────────────────────────────────────────

  async getStats() {
    const [total, pending, confirmed, falsePositive, blacklisted] = await Promise.all([
      this.prisma.fraudFlag.count(),
      this.prisma.fraudFlag.count({ where:{ status:'PENDING' } }),
      this.prisma.fraudFlag.count({ where:{ status:'CONFIRMED_FRAUD' } }),
      this.prisma.fraudFlag.count({ where:{ status:'FALSE_POSITIVE' } }),
      this.prisma.blacklistedAddress.count({ where:{ active:true } }),
    ]);

    return {
      totalFlags: total,
      pendingReview: pending,
      confirmedFraud: confirmed,
      falsePositives: falsePositive,
      accuracyRate: (confirmed+falsePositive) > 0
        ? ((confirmed/(confirmed+falsePositive))*100).toFixed(1)+'%'
        : 'N/A',
      blacklistedAddresses: blacklisted,
    };
  }
}
