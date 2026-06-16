import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }       from '../prisma/prisma.service';
import { RedisService }        from '../redis/redis.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  // ─── Dashboard overview ────────────────────────────────────────────────────

  async getDashboard() {
    const cacheKey = 'analytics:dashboard';
    const cached   = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const [
      totalUsers, totalTransactions, totalVolume,
      pendingKyc, activeBridgeTransfers, totalMerchants,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.transaction.count(),
      this.prisma.transaction.aggregate({ _sum:{ amount:true }, where:{ status:'CONFIRMED' } }),
      this.prisma.kycApplication.count({ where:{ status:'SUBMITTED' } }),
      this.prisma.bridgeTransfer.count({ where:{ status:{ in:['PENDING','LOCKED'] } } }),
      this.prisma.merchant.count(),
    ]);

    const result = {
      totalUsers,
      totalTransactions,
      totalVolumeUSD:        totalVolume._sum.amount?.toString() ?? '0',
      pendingKycApplications: pendingKyc,
      activeBridgeTransfers,
      totalMerchants,
      generatedAt: new Date().toISOString(),
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 60); // 1 min cache
    return result;
  }

  // ─── Volume by chain ────────────────────────────────────────────────────────

  async getVolumeByChain(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const transactions = await this.prisma.transaction.findMany({
      where:  { createdAt:{ gte:since }, status:'CONFIRMED' },
      select: { chain:true, amount:true, tokenSymbol:true },
    });

    const byChain: Record<string, { count: number; volume: Record<string, number> }> = {};
    for (const tx of transactions) {
      if (!byChain[tx.chain]) byChain[tx.chain] = { count:0, volume:{} };
      byChain[tx.chain].count++;
      byChain[tx.chain].volume[tx.tokenSymbol] =
        (byChain[tx.chain].volume[tx.tokenSymbol] ?? 0) + parseFloat(tx.amount.toString());
    }

    return Object.entries(byChain).map(([chain, data]) => ({ chain, ...data }));
  }

  // ─── Volume by token ─────────────────────────────────────────────────────────

  async getVolumeByToken(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const transactions = await this.prisma.transaction.findMany({
      where:  { createdAt:{ gte:since }, status:'CONFIRMED' },
      select: { tokenSymbol:true, amount:true, type:true },
    });

    const byToken: Record<string, { totalVolume: number; sendCount: number; receiveCount: number }> = {};
    for (const tx of transactions) {
      if (!byToken[tx.tokenSymbol]) byToken[tx.tokenSymbol] = { totalVolume:0, sendCount:0, receiveCount:0 };
      byToken[tx.tokenSymbol].totalVolume += parseFloat(tx.amount.toString());
      if (tx.type === 'SEND') byToken[tx.tokenSymbol].sendCount++;
      else byToken[tx.tokenSymbol].receiveCount++;
    }

    return Object.entries(byToken).map(([token, data]) => ({ token, ...data }));
  }

  // ─── Daily volume (time series for charts) ───────────────────────────────────

  async getDailyVolume(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const transactions = await this.prisma.transaction.findMany({
      where:  { createdAt:{ gte:since }, status:'CONFIRMED' },
      select: { createdAt:true, amount:true, tokenSymbol:true },
      orderBy:{ createdAt:'asc' },
    });

    const byDay: Record<string, Record<string, number>> = {};
    for (const tx of transactions) {
      const day = tx.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
      if (!byDay[day]) byDay[day] = {};
      byDay[day][tx.tokenSymbol] = (byDay[day][tx.tokenSymbol] ?? 0) + parseFloat(tx.amount.toString());
    }

    return Object.entries(byDay).map(([date, volumes]) => ({ date, volumes }));
  }

  // ─── Bridge stats ─────────────────────────────────────────────────────────────

  async getBridgeStats(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [total, completed, pending, failed, transfers] = await Promise.all([
    this.prisma.bridgeTransfer.count({ where:{ createdAt:{ gte:since } } }),
    this.prisma.bridgeTransfer.count({ where:{ createdAt:{ gte:since }, status:'COMPLETED' } }),
    this.prisma.bridgeTransfer.count({ where:{ createdAt:{ gte:since }, status:{ in:['PENDING','LOCKED'] } } }),
    this.prisma.bridgeTransfer.count({ where:{ createdAt:{ gte:since }, status:'FAILED' } }),
    this.prisma.bridgeTransfer.findMany({
      where: { createdAt:{ gte:since } },
      select: { srcChain:true, dstChain:true, amount:true },
    }),
  ]);

  // Group manually since amount is a String column (can't use Prisma _sum on it)
  const byRoute: Record<string, { count: number; volume: number }> = {};
  for (const t of transfers) {
    const route = `${t.srcChain} → ${t.dstChain}`;
    if (!byRoute[route]) byRoute[route] = { count:0, volume:0 };
    byRoute[route].count++;
    byRoute[route].volume += parseFloat(t.amount);
  }

  return {
    total, completed, pending, failed,
    successRate: total > 0 ? ((completed/total)*100).toFixed(1)+'%' : '0%',
    byRoute: Object.entries(byRoute).map(([route, data]) => ({
      route, count: data.count, volume: data.volume.toString(),
    })),
  };
}
  // ─── Top users by volume ───────────────────────────────────────────────────────

  async getTopUsers(limit = 10, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get wallets with most transaction volume
    const wallets = await this.prisma.wallet.findMany({
      include: {
        transactions: {
          where:  { createdAt:{ gte:since }, status:'CONFIRMED' },
          select: { amount:true },
        },
        user: { select:{ id:true, email:true, kycStatus:true } },
      },
    });

    const ranked = wallets
      .map(w => ({
        userId:     w.userId,
        email:      w.user.email,
        kycStatus:  w.user.kycStatus,
        chain:      w.chain,
        txCount:    w.transactions.length,
        totalVolume:w.transactions.reduce((s,t)=>s+parseFloat(t.amount.toString()),0),
      }))
      .filter(r => r.txCount > 0)
      .sort((a,b) => b.totalVolume - a.totalVolume)
      .slice(0, limit);

    return ranked;
  }
}
