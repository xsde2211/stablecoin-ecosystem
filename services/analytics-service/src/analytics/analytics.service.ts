import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  async getDashboardStats() {
    const cached = await this.redis.get("analytics:dashboard");
    if (cached) return JSON.parse(cached);

    const [totalUsers, totalTransactions, activeWallets, pendingKyc, pendingAml] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.transaction.count(),
      this.prisma.wallet.count(),
      this.prisma.kycApplication.count({ where: { status: "SUBMITTED" } }),
      this.prisma.amlFlag.count({ where: { status: "PENDING_REVIEW" } }),
    ]);

    const stats = { totalUsers, totalTransactions, activeWallets, pendingKyc, pendingAml, updatedAt: new Date().toISOString() };
    await this.redis.set("analytics:dashboard", JSON.stringify(stats), 60);
    return stats;
  }

  async getVolumeByChain(days = 7) {
    const since = new Date(Date.now() - days * 86_400_000);
    const result = await this.prisma.transaction.groupBy({
      by: ["chain"],
      where: { createdAt: { gte: since }, status: "CONFIRMED" },
      _sum:   { amount: true },
      _count: { id: true },
    });
    return result.map((r) => ({ chain: r.chain, volume: r._sum.amount?.toString() ?? "0", count: r._count.id }));
  }

  async getVolumeByToken(days = 7) {
    const since = new Date(Date.now() - days * 86_400_000);
    const result = await this.prisma.transaction.groupBy({
      by: ["tokenSymbol"],
      where: { createdAt: { gte: since }, status: "CONFIRMED" },
      _sum: { amount: true },
      _count: { id: true },
    });
    return result.map((r) => ({ token: r.tokenSymbol, volume: r._sum.amount?.toString() ?? "0", count: r._count.id }));
  }

  async getDailyVolume(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const txns  = await this.prisma.transaction.findMany({
      where: { createdAt: { gte: since }, status: "CONFIRMED" },
      select: { amount: true, createdAt: true, tokenSymbol: true },
    });

    const byDay: Record<string, { date: string; volume: number; count: number }> = {};
    for (const tx of txns) {
      const day = tx.createdAt.toISOString().split("T")[0];
      if (!byDay[day]) byDay[day] = { date: day, volume: 0, count: 0 };
      byDay[day].volume += parseFloat(tx.amount.toString());
      byDay[day].count  += 1;
    }
    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  }

  async getBridgeStats() {
    const [total, completed, failed, pending] = await Promise.all([
      this.prisma.bridgeTransfer.count(),
      this.prisma.bridgeTransfer.count({ where: { status: "COMPLETED" } }),
      this.prisma.bridgeTransfer.count({ where: { status: "FAILED" } }),
      this.prisma.bridgeTransfer.count({ where: { status: { in: ["PENDING", "LOCKED"] } } }),
    ]);
    const successRate = total > 0 ? ((completed / total) * 100).toFixed(2) : "0";
    return { total, completed, failed, pending, successRate: `${successRate}%` };
  }

  async getTopUsers(limit = 10) {
    const result = await this.prisma.transaction.groupBy({
      by: ["walletId"],
      _count: { id: true },
      _sum:   { amount: true },
      orderBy: { _count: { id: "desc" } },
      take: limit,
    });
    return result.map((r) => ({ walletId: r.walletId, txCount: r._count.id, totalVolume: r._sum.amount?.toString() ?? "0" }));
  }
}
