import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService }  from "../redis/redis.service";
import { ScoreTransactionDto } from "./dto/score-transaction.dto";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskResult {
  score:     number;
  level:     RiskLevel;
  flags:     string[];
  shouldHold: boolean;
}

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  // Threshold amounts in INRX (6 decimals normalized to float)
  private readonly THRESHOLDS = {
    LARGE:       100_000,
    VERY_LARGE:  500_000,
    HIGH_FREQ_1H: 10,
    HIGH_FREQ_1H_CRITICAL: 20,
    NEW_ACCOUNT_DAYS: 7,
    NEW_ACCOUNT_AMOUNT: 10_000,
    KYC_REQUIRED_AMOUNT: 50_000,
  };

  constructor(
    private prisma: PrismaService,
    private redis:  RedisService,
  ) {}

  // ─── Main scoring entry point ─────────────────────────────────────────────

  async scoreTransaction(dto: ScoreTransactionDto): Promise<RiskResult> {
    const flags: string[] = [];
    let score = 0;

    // Run all rules in parallel
    const [amountScore, freqScore, accountScore, kycScore, addressScore] = await Promise.all([
      this.ruleAmountThreshold(dto.amount, flags),
      this.ruleHighFrequency(dto.userId, flags),
      this.ruleNewAccount(dto.userId, dto.amount, flags),
      this.ruleKycStatus(dto.userId, dto.amount, flags),
      this.ruleKnownBadAddress(dto.toAddress, flags),
    ]);

    score = amountScore + freqScore + accountScore + kycScore + addressScore;
    score = Math.min(score, 100); // cap at 100

    const level: RiskLevel =
      score >= 80 ? "CRITICAL" :
      score >= 60 ? "HIGH"     :
      score >= 30 ? "MEDIUM"   : "LOW";

    const shouldHold = level === "CRITICAL" || level === "HIGH";

    this.logger.log(
      `Risk score: ${score} (${level}) for user ${dto.userId} tx ${dto.transactionId} flags=[${flags.join(",")}]`
    );

    // Persist flag if not LOW
    if (level !== "LOW") {
      await this.flagTransaction(dto.transactionId, { score, level, flags, shouldHold });
    }

    return { score, level, flags, shouldHold };
  }

  // ─── Individual rules ─────────────────────────────────────────────────────

  private async ruleAmountThreshold(amount: number, flags: string[]): Promise<number> {
    let s = 0;
    if (amount >= this.THRESHOLDS.VERY_LARGE) { s += 35; flags.push("VERY_LARGE_AMOUNT"); }
    else if (amount >= this.THRESHOLDS.LARGE) { s += 20; flags.push("LARGE_AMOUNT"); }
    return s;
  }

  private async ruleHighFrequency(userId: string, flags: string[]): Promise<number> {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId }, select: { id: true },
    });
    const walletIds = wallets.map((w) => w.id);

    const recentCount = await this.prisma.transaction.count({
      where: {
        walletId:  { in: walletIds },
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });

    if (recentCount >= this.THRESHOLDS.HIGH_FREQ_1H_CRITICAL) { flags.push("VERY_HIGH_FREQUENCY"); return 25; }
    if (recentCount >= this.THRESHOLDS.HIGH_FREQ_1H)          { flags.push("HIGH_FREQUENCY");      return 15; }
    return 0;
  }

  private async ruleNewAccount(userId: string, amount: number, flags: string[]): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }, select: { createdAt: true },
    });
    if (!user) return 0;

    const ageDays = (Date.now() - user.createdAt.getTime()) / 86_400_000;
    if (ageDays < this.THRESHOLDS.NEW_ACCOUNT_DAYS && amount > this.THRESHOLDS.NEW_ACCOUNT_AMOUNT) {
      flags.push("NEW_ACCOUNT_LARGE_TX");
      return 25;
    }
    return 0;
  }

  private async ruleKycStatus(userId: string, amount: number, flags: string[]): Promise<number> {
    if (amount < this.THRESHOLDS.KYC_REQUIRED_AMOUNT) return 0;
    const user = await this.prisma.user.findUnique({
      where: { id: userId }, select: { kycStatus: true },
    });
    if (user?.kycStatus !== "APPROVED") {
      flags.push("KYC_NOT_APPROVED_LARGE_TX");
      return 20;
    }
    return 0;
  }

  private async ruleKnownBadAddress(address: string, flags: string[]): Promise<number> {
    // Check Redis blacklist (populated by admin or external threat intel)
    const isBlacklisted = await this.redis.exists(`blacklist:addr:${address.toLowerCase()}`);
    if (isBlacklisted) {
      flags.push("BLACKLISTED_ADDRESS");
      return 100; // auto critical
    }
    return 0;
  }

  // ─── AML flag persistence ─────────────────────────────────────────────────

  async flagTransaction(transactionId: string, result: RiskResult) {
    await this.prisma.amlFlag.create({
      data: {
        transactionId,
        riskLevel: result.level,
        reason:    result.flags.join(", "),
        status:    result.level === "CRITICAL" ? "ESCALATED" : "PENDING_REVIEW",
      },
    });
  }

  // ─── AML management ───────────────────────────────────────────────────────

  async getFlags(status?: string, page = 1, limit = 50) {
    const where: any = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.amlFlag.findMany({
        where,
        include: { transaction: { select: { txHash: true, chain: true, amount: true, tokenSymbol: true } } },
        orderBy: { flaggedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.amlFlag.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async resolveFlag(flagId: string, resolution: "CLEARED" | "REPORTED", resolvedBy: string) {
    const flag = await this.prisma.amlFlag.update({
      where: { id: flagId },
      data:  { status: resolution, resolvedBy, resolvedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        userId:     resolvedBy,
        action:     `AML_${resolution}`,
        entityType: "AmlFlag",
        entityId:   flagId,
        payload:    { resolution },
      },
    });

    this.logger.log(`AML flag ${flagId} resolved as ${resolution} by ${resolvedBy}`);
    return flag;
  }

  async blacklistAddress(address: string, addedBy: string) {
    await this.redis.set(`blacklist:addr:${address.toLowerCase()}`, "1");
    await this.prisma.auditLog.create({
      data: {
        userId:     addedBy,
        action:     "BLACKLIST_ADDRESS",
        entityType: "Address",
        entityId:   address,
        payload:    { address },
      },
    });
    this.logger.warn(`Address blacklisted: ${address} by ${addedBy}`);
    return { message: "Address blacklisted", address };
  }

  async getFlagStats() {
    const [total, pending, escalated, cleared, reported] = await Promise.all([
      this.prisma.amlFlag.count(),
      this.prisma.amlFlag.count({ where: { status: "PENDING_REVIEW" } }),
      this.prisma.amlFlag.count({ where: { status: "ESCALATED" } }),
      this.prisma.amlFlag.count({ where: { status: "CLEARED" } }),
      this.prisma.amlFlag.count({ where: { status: "REPORTED" } }),
    ]);
    return { total, pending, escalated, cleared, reported };
  }
}
