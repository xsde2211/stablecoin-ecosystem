import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ethers } from 'ethers';
import { TronWeb } from 'tronweb';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SuspendUserDto} from './dto/suspend-user.dto';
import { UserRole } from '@prisma/client';

// ─── On-chain role registry ─────────────────────────────────────────────────
//
// Matches your deployed contracts exactly:
//   INRX / EGold / ESilver  → MINTER_ROLE, BURNER_ROLE, FREEZER_ROLE, BLACKLISTER_ROLE, UPGRADER_ROLE, TREASURY_ROLE
//   TreasuryTimelock        → SIGNER_ROLE, GUARDIAN_ROLE
//   StablecoinBridgeV2      → VALIDATOR_ROLE, RELAYER_ROLE, PAUSER_ROLE
//   ReserveVault            → CUSTODIAN_ROLE, AUDITOR_ROLE
//   OracleManager           → ORACLE_ROLE, MANAGER_ROLE
//
// Only EVM chains — these contracts use OpenZeppelin AccessControl, which the
// TRON side doesn't mirror consistently, so it's intentionally left out here.

const TOKEN_ROLES = ['MINTER_ROLE', 'BURNER_ROLE', 'FREEZER_ROLE', 'BLACKLISTER_ROLE', 'UPGRADER_ROLE', 'TREASURY_ROLE'];

const CONTRACT_REGISTRY: Record<string, { label: string; envSuffix: string; roles: string[] }> = {
  INRX:              { label: 'INRX',              envSuffix: 'INRX_ADDRESS',              roles: TOKEN_ROLES },
  EGOLD:             { label: 'EGold',              envSuffix: 'EGOLD_ADDRESS',             roles: TOKEN_ROLES },
  ESLVR:             { label: 'ESilver',            envSuffix: 'ESLVR_ADDRESS',             roles: TOKEN_ROLES },
  TREASURY_TIMELOCK: { label: 'TreasuryTimelock',   envSuffix: 'TREASURY_TIMELOCK_ADDRESS', roles: ['SIGNER_ROLE', 'GUARDIAN_ROLE'] },
  BRIDGE_V2:         { label: 'StablecoinBridgeV2', envSuffix: 'BRIDGE_V2_ADDRESS',          roles: ['VALIDATOR_ROLE', 'RELAYER_ROLE', 'PAUSER_ROLE'] },
  RESERVE_VAULT:     { label: 'ReserveVault',       envSuffix: 'RESERVE_VAULT_ADDRESS',      roles: ['CUSTODIAN_ROLE', 'AUDITOR_ROLE'] },
  ORACLE_MANAGER:    { label: 'OracleManager',      envSuffix: 'ORACLE_MANAGER_ADDRESS',     roles: ['ORACLE_ROLE', 'MANAGER_ROLE'] },
};

const CHAIN_PREFIX: Record<string, string> = { ethereum: 'ETH', bsc: 'BSC', polygon: 'POLYGON', tron: 'TRON' };
const EVM_RPC_ENV: Record<string, string> = { ethereum: 'ETH_RPC', bsc: 'BSC_RPC', polygon: 'POLYGON_RPC' };

const ACCESS_CONTROL_ABI = [
  'function grantRole(bytes32 role, address account)',
  'function revokeRole(bytes32 role, address account)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
];

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

    // Requirement: every SUPER_ADMIN automatically gets every on-chain role,
    // on every contract, on every EVM chain, for their own wallet. This is
    // many sequential on-chain transactions (contracts × roles × chains), so
    // it runs in the background rather than blocking this response — check
    // the audit log or GET /admin/users/:id/onchain-roles for progress.
    if (dto.role === 'SUPER_ADMIN' && oldRole !== 'SUPER_ADMIN') {
      this.grantAllRolesToUser(userId, updatedBy).catch((err) =>
        this.logger.error(`Auto on-chain role grant failed for ${userId}: ${err.message}`)
      );
    }

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

  // ─── On-chain role management — SUPER_ADMIN only (enforced by SuperAdminGuard) ─

  getRoleRegistry() {
    return {
      chains: Object.keys(CHAIN_PREFIX),
      contracts: Object.entries(CONTRACT_REGISTRY).map(([key, v]) => ({
        key, label: v.label, roles: v.roles,
      })),
    };
  }

  private getContractAddress(chain: string, contractKey: string): string {
    const prefix = CHAIN_PREFIX[chain];
    if (!prefix) throw new BadRequestException(`Unsupported chain for on-chain roles: ${chain}`);
    const entry = CONTRACT_REGISTRY[contractKey];
    if (!entry) throw new BadRequestException(`Unknown contract: ${contractKey}`);
    const address = process.env[`${prefix}_${entry.envSuffix}`];
    if (!address) throw new BadRequestException(`${entry.label} is not configured on ${chain}`);
    return address;
  }

  // Cached — one provider per chain, reused across calls, with an explicit
  // static network so ethers skips its auto-detect handshake (the source of
  // the "JsonRpcProvider failed to detect network... retry in 1s" spam when
  // a fresh provider's detection call fails or gets rate-limited).
  private readonly providerCache = new Map<string, ethers.JsonRpcProvider>();
  private static readonly CHAIN_IDS: Record<string, number> = {
    ethereum: 11155111, bsc: 97, polygon: 80002,
  };

  private getCachedProvider(chain: string, rpcUrl: string): ethers.JsonRpcProvider {
    const cached = this.providerCache.get(chain);
    if (cached) return cached;
    const chainId = AdminService.CHAIN_IDS[chain];
    const provider = chainId
      ? new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true })
      : new ethers.JsonRpcProvider(rpcUrl);
    this.providerCache.set(chain, provider);
    return provider;
  }

  private getDeployerSigner(chain: string): ethers.Wallet {
    const rpcEnvVar = EVM_RPC_ENV[chain];
    const rpcUrl = rpcEnvVar && process.env[rpcEnvVar];
    if (!rpcUrl) throw new BadRequestException(`No RPC configured for ${chain}`);

    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY not configured — cannot administer on-chain roles');

    const provider = this.getCachedProvider(chain, rpcUrl);
    return new ethers.Wallet(deployerKey, provider);
  }

  private getTronContract(contractAddress: string) {
    const deployerKey = process.env.DEPLOYER_TRON_PRIVATE_KEY;
    if (!deployerKey) throw new Error('DEPLOYER_TRON_PRIVATE_KEY not configured — cannot administer on-chain roles on TRON');

    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: deployerKey,
      headers:    { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
    });
    return tronWeb.contract().at(contractAddress);
  }

  private assertValidRole(contractKey: string, roleName: string) {
    const entry = CONTRACT_REGISTRY[contractKey];
    if (!entry) throw new BadRequestException(`Unknown contract: ${contractKey}`);
    if (!entry.roles.includes(roleName)) {
      throw new BadRequestException(`${roleName} is not a valid role for ${entry.label}. Valid roles: ${entry.roles.join(', ')}`);
    }
  }

  private async setOnChainRole(
    chain: string, contractKey: string, roleName: string, targetAddress: string,
    actingUserId: string, action: 'grant' | 'revoke',
  ) {
    this.assertValidRole(contractKey, roleName);
    const contractAddress = this.getContractAddress(chain, contractKey);
    const roleHash = ethers.keccak256(ethers.toUtf8Bytes(roleName));

    let txHash: string;

    if (chain === 'tron') {
      // TRON addresses come in as base58 (T...) — TronWeb's contract interface
      // accepts that directly, no conversion needed for a plain call like this
      // (only off-chain message-hash signing, elsewhere, needs the raw hex form).
      if (!targetAddress || targetAddress.length < 25) throw new BadRequestException('Invalid TRON target address');
      const contract = await this.getTronContract(contractAddress);
      txHash = action === 'grant'
        ? await contract.grantRole(roleHash, targetAddress).send({ feeLimit: 100_000_000 })
        : await contract.revokeRole(roleHash, targetAddress).send({ feeLimit: 100_000_000 });
    } else {
      if (!ethers.isAddress(targetAddress)) throw new BadRequestException('Invalid target address');
      const signer   = this.getDeployerSigner(chain);
      const contract = new ethers.Contract(contractAddress, ACCESS_CONTROL_ABI, signer);
      const tx = action === 'grant'
        ? await contract.grantRole(roleHash, targetAddress)
        : await contract.revokeRole(roleHash, targetAddress);
      const receipt = await tx.wait();
      txHash = receipt.hash;
    }

    await this.prisma.auditLog.create({
      data: {
        userId:     actingUserId,
        action:     action === 'grant' ? 'ADMIN_GRANT_ONCHAIN_ROLE' : 'ADMIN_REVOKE_ONCHAIN_ROLE',
        entityType: 'OnChainRole',
        entityId:   `${chain}:${contractKey}:${roleName}`,
        payload:    { chain, contract: contractKey, role: roleName, target: targetAddress, txHash },
      },
    });

    this.logger.warn(
      `${action.toUpperCase()} ${roleName} on ${CONTRACT_REGISTRY[contractKey].label}/${chain} for ${targetAddress} by ${actingUserId} (tx ${txHash})`
    );

    return {
      txHash, status: 'CONFIRMED',
      chain, contract: contractKey, role: roleName, target: targetAddress, action,
    };
  }

  grantOnChainRole(chain: string, contractKey: string, roleName: string, targetAddress: string, actingUserId: string) {
    return this.setOnChainRole(chain, contractKey, roleName, targetAddress, actingUserId, 'grant');
  }

  revokeOnChainRole(chain: string, contractKey: string, roleName: string, targetAddress: string, actingUserId: string) {
    return this.setOnChainRole(chain, contractKey, roleName, targetAddress, actingUserId, 'revoke');
  }

  async checkOnChainRole(chain: string, contractKey: string, roleName: string, targetAddress: string) {
    this.assertValidRole(contractKey, roleName);
    const contractAddress = this.getContractAddress(chain, contractKey);
    const roleHash = ethers.keccak256(ethers.toUtf8Bytes(roleName));

    if (chain === 'tron') {
      if (!targetAddress || targetAddress.length < 25) throw new BadRequestException('Invalid TRON address');
      // TronWeb throws "owner_address isn't set" on ANY contract call —
      // including pure view/read calls like hasRole() — unless the instance
      // has a default address configured. It doesn't need to be able to
      // sign anything for a read; reusing the deployer's key here just gives
      // TronWeb an owner_address to attach to the call, it has no bearing
      // on the (read-only) result itself.
      const deployerKey = process.env.DEPLOYER_TRON_PRIVATE_KEY;
      if (!deployerKey) throw new Error('DEPLOYER_TRON_PRIVATE_KEY not configured — needed even for read-only TRON calls');
      const tronWeb = new TronWeb({
        fullHost:   process.env.TRON_RPC!,
        privateKey: deployerKey,
        headers:    { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
      });
      const contract = await tronWeb.contract().at(contractAddress);
      const hasRole = await contract.hasRole(roleHash, targetAddress).call();
      return { chain, contract: contractKey, role: roleName, target: targetAddress, hasRole };
    }

    if (!ethers.isAddress(targetAddress)) throw new BadRequestException('Invalid address');
    const rpcUrl = process.env[EVM_RPC_ENV[chain]]!;
    const provider = this.getCachedProvider(chain, rpcUrl);
    const contract = new ethers.Contract(contractAddress, ACCESS_CONTROL_ABI, provider);

    const hasRole = await contract.hasRole(roleHash, targetAddress);
    return { chain, contract: contractKey, role: roleName, target: targetAddress, hasRole };
  }

  // Requirement #1: a SUPER_ADMIN automatically gets EVERY role, on EVERY
  // contract, on EVERY chain (EVM + TRON), for each of their own wallets.
  // Sequential on-chain transactions — can take a while for many
  // wallets/contracts/roles, so callers (updateRole, and the manual re-sync
  // endpoint) run this in the background rather than awaiting it inline.
  async grantAllRolesToUser(userId: string, actingUserId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, chain: { in: Object.keys(CHAIN_PREFIX) } },
    });
    if (!wallets.length) {
      throw new BadRequestException('User has no wallet yet — they must create one before roles can be granted');
    }

    const results: Array<Record<string, any>> = [];

    for (const wallet of wallets) {
      for (const contractKey of Object.keys(CONTRACT_REGISTRY)) {
        let contractAddress: string;
        try { contractAddress = this.getContractAddress(wallet.chain, contractKey); }
        catch { continue; } // contract not deployed on this chain — skip quietly

        for (const roleName of CONTRACT_REGISTRY[contractKey].roles) {
          try {
            const res = await this.grantOnChainRole(wallet.chain, contractKey, roleName, wallet.address, actingUserId);
            results.push({ ...res, ok: true });
          } catch (err: any) {
            results.push({ chain: wallet.chain, contract: contractKey, role: roleName, target: wallet.address, ok: false, error: err.message });
          }
        }
      }
    }

    const grantedCount = results.filter((r) => r.ok).length;
    const failedCount  = results.filter((r) => !r.ok).length;

    await this.prisma.auditLog.create({
      data: {
        userId: actingUserId, action: 'ADMIN_GRANT_ALL_ONCHAIN_ROLES', entityType: 'User', entityId: userId,
        payload: { grantedCount, failedCount },
      },
    });

    this.logger.warn(`Granted ${grantedCount} on-chain roles (${failedCount} failed) to SUPER_ADMIN user ${userId}`);
    return { userId, grantedCount, failedCount, results };
  }
}