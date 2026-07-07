import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ethers } from 'ethers';
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

  // ─── System roles / signers — for the admin Mint/Burn testing page ────────────
  //
  // Surfaces WHO holds each on-chain role, by public address only. Never reads
  // or returns a *_PRIVATE_KEY env var — only the *_ADDRESS companions that
  // already exist for every role except MINTER, which has no address var of
  // its own, so that one address is derived (never the key itself returned).

  async getSystemRoles() {
    const addr = (key: string): string | null => process.env[key] || null;

    const deriveEvmAddress = (privateKeyEnvVar: string): string | null => {
      const pk = process.env[privateKeyEnvVar];
      if (!pk) return null;
      try { return ethers.computeAddress(pk.startsWith('0x') ? pk : `0x${pk}`); }
      catch { return null; }
    };

    const signersAndValidators = [1, 2, 3].map((n) => ({
      label: `Signer / Validator ${n}`,
      evm:   addr(`SIGNER_${n}_ADDRESS`),
      tron:  addr(`TRON_SIGNER_${n}_ADDRESS`),
      note:  'Bridge validator signature + treasury multi-sig signer (same person, both hats)',
    }));

    const oracleTeam = [1, 2].map((n) => ({
      label: `Oracle ${n}`,
      evm:   addr(`ORACLE_${n}_ADDRESS`),
      tron:  addr(`TRON_ORACLE_${n}_ADDRESS`),
      note:  'Submits live gold/silver price updates to OracleManager',
    }));

    // Human staff accounts (DB users), distinct from on-chain key-holder roles above
    const staffUsers = await this.prisma.user.findMany({
      where:   { role: { in: ['ADMIN', 'SUPER_ADMIN', 'COMPLIANCE'] } },
      select:  { id: true, email: true, role: true, isActive: true, createdAt: true },
      orderBy: { role: 'asc' },
    });

    return {
      deployerGuardian: {
        label: 'Deployer / Guardian',
        evm:   addr('DEPLOYER_ADDRESS'),
        tron:  addr('DEPLOYER_TRON_ADDRESS'),
        note:  'Deploys contracts, holds DEFAULT_ADMIN_ROLE, can pause contracts (Guardian)',
      },
      minter: {
        label: 'Minter',
        evm:   addr('MINTER_ADDRESS') ?? deriveEvmAddress('MINTER_PRIVATE_KEY'),
        note:  'Holds MINTER_ROLE — can mint tokens directly via /stablecoin/mint (testing only, bypasses treasury timelock)',
      },
      burner: {
        label: 'Burner',
        evm:   addr('SIGNER_1_ADDRESS'),
        note:  'Holds BURNER_ROLE — reuses the Signer 1 key for /stablecoin/burn (testing only, bypasses treasury timelock)',
      },
      signersAndValidators,
      relayer: {
        label: 'Relayer',
        evm:   addr('RELAYER_ADDRESS'),
        tron:  addr('RELAYER_TRON_ADDRESS'),
        note:  'Submits lock/mint/burn/unlock transactions on behalf of the bridge',
      },
      custodianAuditor: {
        label: 'Custodian / Auditor',
        evm:   addr('CUSTODIAN_ADDRESS'),
        tron:  addr('TRON_CUSTODIAN_ADDRESS'),
        note:  'ReserveVault roles — records and audits real-world asset backing',
      },
      oracleTeam,
      complianceOnChain: {
        blacklister: {
          label: 'Blacklister',
          evm:   addr('BLACKLISTER_ADDRESS'),
          tron:  addr('TRON_BLACKLISTER_ADDRESS'),
          note:  'Can blacklist addresses on any token contract',
        },
        freezer: {
          label: 'Freezer',
          evm:   addr('FREEZER_ADDRESS'),
          tron:  addr('TRON_FREEZER_ADDRESS'),
          note:  'Can freeze addresses on any token contract',
        },
      },
      requiredValidators: process.env.REQUIRED_VALIDATORS ?? '2',
      staffUsers,
      generatedAt: new Date().toISOString(),
    };
  }
}