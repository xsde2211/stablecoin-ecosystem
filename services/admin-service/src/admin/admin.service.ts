import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SuspendUserDto} from './dto/suspend-user.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  // ─── User management ────────────────────────────────────────────────────────

  async getUsers(page=1, limit=20, search?: string, kycStatus?: string) {
    const where: any = {};
    if (search)    where.OR = [{ email:{ contains:search, mode:'insensitive' } }, { phone:{ contains:search } }];
    if (kycStatus) where.kycStatus = kycStatus;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where, orderBy:{ createdAt:'desc' }, skip:(page-1)*limit, take:limit,
        select: { id:true, email:true, phone:true, role:true, kycStatus:true, isActive:true, twoFaEnabled:true, createdAt:true },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, total, page, limit, totalPages:Math.ceil(total/limit) };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where:   { id:userId },
      select:  {
        id:true, email:true, phone:true, role:true, kycStatus:true, isActive:true,
        twoFaEnabled:true, createdAt:true,
        wallets:      { select:{ chain:true, address:true } },
        kycApplications: { orderBy:{ createdAt:'desc' }, take:5 },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Get transaction count and total volume
    const walletIds = user.wallets.length
      ? await this.prisma.wallet.findMany({ where:{ userId }, select:{ id:true } }).then(w=>w.map(x=>x.id))
      : [];

    const [txCount, fraudFlags] = await Promise.all([
      this.prisma.transaction.count({ where:{ walletId:{ in:walletIds } } }),
      this.prisma.fraudFlag.count({ where:{ userId } }),
    ]);

    return { ...user, transactionCount:txCount, fraudFlagCount:fraudFlags };
  }

  async suspendUser(userId: string, dto: SuspendUserDto, suspendedBy: string) {
    const user = await this.prisma.user.findUnique({ where:{ id:userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive) throw new BadRequestException('User already suspended');

    await this.prisma.user.update({ where:{ id:userId }, data:{ isActive:false } });

    await this.prisma.auditLog.create({
      data: { userId:suspendedBy, action:'ADMIN_SUSPEND_USER', entityType:'User', entityId:userId,
              payload:{ reason:dto.reason, suspendedUserId:userId } },
    });

    this.logger.warn(`User ${userId} suspended by ${suspendedBy}: ${dto.reason}`);
    return { message:'User suspended', userId, reason:dto.reason };
  }

  async unsuspendUser(userId: string, unsuspendedBy: string) {
    const user = await this.prisma.user.findUnique({ where:{ id:userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isActive) throw new BadRequestException('User is not suspended');

    await this.prisma.user.update({ where:{ id:userId }, data:{ isActive:true } });

    await this.prisma.auditLog.create({
      data: { userId:unsuspendedBy, action:'ADMIN_UNSUSPEND_USER', entityType:'User', entityId:userId, payload:{} },
    });

    this.logger.log(`User ${userId} unsuspended by ${unsuspendedBy}`);
    return { message:'User unsuspended', userId };
  }

  async updateRole(userId: string, dto: UpdateRoleDto, updatedBy: string) {
    const user = await this.prisma.user.findUnique({ where:{ id:userId } });
    if (!user) throw new NotFoundException('User not found');

    const oldRole = user.role;
    await this.prisma.user.update({ where:{ id:userId }, data:{ role: dto.role as UserRole } });

    await this.prisma.auditLog.create({
      data: { userId:updatedBy, action:'ADMIN_UPDATE_ROLE', entityType:'User', entityId:userId,
              payload:{ oldRole, newRole:dto.role } },
    });

    this.logger.log(`User ${userId} role changed: ${oldRole} → ${dto.role} by ${updatedBy}`);
    return { message:'Role updated', userId, oldRole, newRole:dto.role };
  }

  // ─── Transactions ────────────────────────────────────────────────────────────

  async getTransactions(page=1, limit=20, chain?: string, status?: string) {
    const where: any = {};
    if (chain)  where.chain  = chain;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where, orderBy:{ createdAt:'desc' }, skip:(page-1)*limit, take:limit,
        include: { wallet: { select:{ userId:true, chain:true, address:true } } },
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return { data, total, page, limit, totalPages:Math.ceil(total/limit) };
  }

  // ─── Bridge transfers ─────────────────────────────────────────────────────────

  async getBridgeTransfers(page=1, limit=20, status?: string) {
    const where: any = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.bridgeTransfer.findMany({
        where, orderBy:{ createdAt:'desc' }, skip:(page-1)*limit, take:limit,
        include: { user: { select:{ email:true } } },
      }),
      this.prisma.bridgeTransfer.count({ where }),
    ]);
    return { data, total, page, limit, totalPages:Math.ceil(total/limit) };
  }

  // ─── System stats ─────────────────────────────────────────────────────────────

  async getStats() {
    const [
      totalUsers, activeUsers, suspendedUsers,
      kycApproved, kycPending, totalMerchants,
      totalTransactions, totalBridgeTransfers,
      pendingFraudFlags,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where:{ isActive:true } }),
      this.prisma.user.count({ where:{ isActive:false } }),
      this.prisma.user.count({ where:{ kycStatus:'APPROVED' } }),
      this.prisma.user.count({ where:{ kycStatus:'SUBMITTED' } }),
      this.prisma.merchant.count(),
      this.prisma.transaction.count(),
      this.prisma.bridgeTransfer.count(),
      this.prisma.fraudFlag.count({ where:{ status:'PENDING' } }),
    ]);

    return {
      users: { total:totalUsers, active:activeUsers, suspended:suspendedUsers },
      kyc:   { approved:kycApproved, pending:kycPending },
      merchants: totalMerchants,
      transactions: totalTransactions,
      bridgeTransfers: totalBridgeTransfers,
      pendingFraudFlags,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Audit logs ────────────────────────────────────────────────────────────────

  async getAuditLogs(page=1, limit=50, userId?: string, action?: string) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where, orderBy:{ createdAt:'desc' }, skip:(page-1)*limit, take:limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total, page, limit, totalPages:Math.ceil(total/limit) };
  }
}
