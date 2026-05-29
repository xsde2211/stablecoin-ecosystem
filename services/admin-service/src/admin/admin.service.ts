import { Injectable, Logger, NotFoundException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService }  from "../redis/redis.service";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(
    private prisma: PrismaService,
    private redis:  RedisService,
  ) {}

  // ─── User management ──────────────────────────────────────────────────────

  async getUsers(page = 1, limit = 50, search?: string) {
    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, phone: true, role: true,
          kycStatus: true, riskScore: true, isActive: true, createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallets: { select: { chain: true, address: true } },
        kycApplications: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async suspendUser(userId: string, adminId: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    if (user.role === "SUPER_ADMIN") throw new ForbiddenException("Cannot suspend super admin");

    await this.prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    // Invalidate all active sessions for this user
    await this.redis.set(`suspended:${userId}`, "1");

    await this.logAction(adminId, "SUSPEND_USER", "User", userId, { reason });
    this.logger.warn(`User ${userId} suspended by admin ${adminId}: ${reason}`);
    return { message: "User suspended successfully" };
  }

  async unsuspendUser(userId: string, adminId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { isActive: true } });
    await this.redis.del(`suspended:${userId}`);
    await this.logAction(adminId, "UNSUSPEND_USER", "User", userId, {});
    return { message: "User unsuspended successfully" };
  }

  async updateUserRole(userId: string, role: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    await this.prisma.user.update({ where: { id: userId }, data: { role: role as any } });
    await this.logAction(adminId, "UPDATE_USER_ROLE", "User", userId, { role });
    return { message: `Role updated to ${role}` };
  }

  // ─── Transaction management ───────────────────────────────────────────────

  async getTransactions(page = 1, limit = 50, chain?: string, status?: string) {
    const where: any = {};
    if (chain)  where.chain  = chain;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
        include: { wallet: { select: { userId: true, chain: true } } },
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  // ─── System stats ─────────────────────────────────────────────────────────

  async getSystemStats() {
    const [
      totalUsers, activeUsers, suspendedUsers,
      totalTxns, pendingTxns,
      totalBridges, pendingBridges,
      pendingKyc, approvedKyc,
      pendingAml, criticalAml,
      totalMerchants,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { isActive: false } }),
      this.prisma.transaction.count(),
      this.prisma.transaction.count({ where: { status: "PENDING" } }),
      this.prisma.bridgeTransfer.count(),
      this.prisma.bridgeTransfer.count({ where: { status: { in: ["PENDING", "LOCKED"] } } }),
      this.prisma.kycApplication.count({ where: { status: "SUBMITTED" } }),
      this.prisma.kycApplication.count({ where: { status: "APPROVED" } }),
      this.prisma.amlFlag.count({ where: { status: "PENDING_REVIEW" } }),
      this.prisma.amlFlag.count({ where: { status: "ESCALATED" } }),
      this.prisma.merchant.count(),
    ]);

    return {
      users:     { total: totalUsers, active: activeUsers, suspended: suspendedUsers },
      transactions: { total: totalTxns, pending: pendingTxns },
      bridges:   { total: totalBridges, pending: pendingBridges },
      kyc:       { pending: pendingKyc, approved: approvedKyc },
      aml:       { pending: pendingAml, critical: criticalAml },
      merchants: totalMerchants,
      updatedAt: new Date().toISOString(),
    };
  }

  // ─── Audit logs ───────────────────────────────────────────────────────────

  async getAuditLogs(page = 1, limit = 100, userId?: string, action?: string) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (action) where.action = { contains: action, mode: "insensitive" };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  // ─── Bridge monitoring ───────────────────────────────────────────────────

  async getBridgeTransfers(page = 1, limit = 50, status?: string) {
    const where: any = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.bridgeTransfer.findMany({
        where,
        orderBy:  { createdAt: "desc" },
        skip:     (page - 1) * limit,
        take:     limit,
        include:  { validatorSignatures: true },
      }),
      this.prisma.bridgeTransfer.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async logAction(
    adminId:    string,
    action:     string,
    entityType: string,
    entityId:   string,
    payload:    object,
  ) {
    await this.prisma.auditLog.create({
      data: { userId: adminId, action, entityType, entityId, payload },
    });
  }
}
