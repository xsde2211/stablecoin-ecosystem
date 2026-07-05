import {
  Injectable, BadRequestException,
  NotFoundException, Logger,
} from '@nestjs/common';
import { ethers }        from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import { ProposeDto }    from './dto/propose.dto';
import { SignDto }       from './dto/sign.dto';

// Full TreasuryTimelock ABI matching our V2 contract
const TIMELOCK_ABI = [
  // Propose — returns opId
  'function propose(bytes32 tokenId, uint8 opType, address target, uint256 amount, string reason) returns (uint256)',
  // Sign — adds signature, queues if threshold reached
  'function sign(uint256 opId)',
  // Execute — anyone can call after delay passes
  'function execute(uint256 opId)',
  // Cancel — guardian only
  'function cancel(uint256 opId, string reason)',
  // Views
  'function getOperation(uint256 opId) view returns (bytes32 tokenId, uint8 opType, address target, uint256 amount, string reason, uint256 approvals, uint8 status, uint256 createdAt, uint256 executeAfter)',
  'function hasSigned(uint256 opId, address signer) view returns (bool)',
  'function getRemainingDelay(uint256 opId) view returns (uint256)',
  'function requiredSignatures() view returns (uint256)',
  'function timelockDelay() view returns (uint256)',
  'function dailyMintLimit(bytes32 tokenId) view returns (uint256)',
  'function dailyMintedToday(bytes32 tokenId) view returns (uint256)',
  'function opCount() view returns (uint256)',
  // Events
  'event OperationProposed(uint256 indexed opId, bytes32 indexed tokenId, uint8 opType, address target, uint256 amount, address proposer)',
  'event OperationQueued(uint256 indexed opId, uint256 executeAfter)',
  'event OperationExecuted(uint256 indexed opId, address executor)',
  'event OperationCancelled(uint256 indexed opId, address cancelledBy, string reason)',
];

// Token IDs — keccak256 of symbol string (must match contracts)
const TOKEN_IDS: Record<string, string> = {
  INRX:  ethers.keccak256(ethers.toUtf8Bytes('INRX')),
  EGOLD: ethers.keccak256(ethers.toUtf8Bytes('EGOLD')),
  ESLVR: ethers.keccak256(ethers.toUtf8Bytes('ESLVR')),
};

// OpType enum matching TreasuryTimelock.sol
const OP_TYPES: Record<string, number> = {
  MINT:    0,
  BURN:    1,
  PAUSE:   2,
  UNPAUSE: 3,
};

const OP_STATUS: Record<number, string> = {
  0: 'PENDING',
  1: 'APPROVED',
  2: 'QUEUED',
  3: 'EXECUTED',
  4: 'CANCELLED',
  5: 'EXPIRED',
};

@Injectable()
export class TreasuryService {
  private readonly logger = new Logger(TreasuryService.name);

  constructor(
    private prisma: PrismaService,
    private redis:  RedisService,
  ) {}

  // ─── Propose operation ──────────────────────────────────────────────────────

  async propose(dto: ProposeDto, proposedBy: string) {
    const { contract, provider } = this.getContract(dto.chain, 'signer1');

    const tokenId   = TOKEN_IDS[dto.token];
    const opTypeNum = OP_TYPES[dto.opType];
    const target    = dto.targetAddress ?? ethers.ZeroAddress;
    const amount    = dto.amount ? ethers.parseUnits(dto.amount, 6) : 0n;

    if ((dto.opType === 'MINT' || dto.opType === 'BURN') && !dto.amount) {
      throw new BadRequestException('amount is required for MINT and BURN operations');
    }
    if ((dto.opType === 'MINT' || dto.opType === 'BURN') && !dto.targetAddress) {
      throw new BadRequestException('targetAddress is required for MINT and BURN operations');
    }

    const tx      = await contract.propose(tokenId, opTypeNum, target, amount, dto.reason);
    const receipt = await tx.wait();

    // Parse opId from event
    const iface = new ethers.Interface(TIMELOCK_ABI);
    let opId    = '0';
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'OperationProposed') {
          opId = parsed.args.opId.toString();
          break;
        }
      } catch {}
    }

    // Cache for quick lookup
    await this.redis.set(
      `treasury:op:${dto.chain}:${opId}`,
      JSON.stringify({ chain:dto.chain, token:dto.token, opType:dto.opType, amount:dto.amount, reason:dto.reason }),
      86400,
    );

    await this.prisma.auditLog.create({
      data: {
        userId:     proposedBy,
        action:     'TREASURY_PROPOSE',
        entityType: 'Treasury',
        entityId:   opId,
        payload:    { chain:dto.chain, token:dto.token, opType:dto.opType, amount:dto.amount, reason:dto.reason, txHash:receipt.hash },
      },
    });

    this.logger.log(`Treasury op proposed: opId=${opId} chain=${dto.chain} by ${proposedBy}`);
    return { opId, txHash:receipt.hash, chain:dto.chain, token:dto.token, opType:dto.opType };
  }

  // ─── Sign operation ──────────────────────────────────────────────────────────

  async sign(dto: SignDto, signedBy: string, signerIndex: 1|2|3 = 1) {
    const { contract } = this.getContract(dto.chain, `signer${signerIndex}`);

    const op = await this.getOperationDetails(dto.chain, dto.opId);
    if (op.status === 'EXECUTED')  throw new BadRequestException('Operation already executed');
    if (op.status === 'CANCELLED') throw new BadRequestException('Operation already cancelled');

    const tx      = await contract.sign(BigInt(dto.opId));
    const receipt = await tx.wait();

    await this.prisma.auditLog.create({
      data: {
        userId:     signedBy,
        action:     'TREASURY_SIGN',
        entityType: 'Treasury',
        entityId:   dto.opId,
        payload:    { chain:dto.chain, opId:dto.opId, txHash:receipt.hash },
      },
    });

    this.logger.log(`Treasury op ${dto.opId} signed on ${dto.chain}`);

    // Refresh op details
    const updated = await this.getOperationDetails(dto.chain, dto.opId);
    return { txHash:receipt.hash, opId:dto.opId, ...updated };
  }

  // ─── Execute operation ───────────────────────────────────────────────────────

  async execute(chain: string, opId: string, executedBy: string) {
    // Anyone can execute after delay — no specific signer needed
    const { contract } = this.getContract(chain, 'signer1');

    const op = await this.getOperationDetails(chain, opId);
    if (op.status !== 'QUEUED') throw new BadRequestException(`Cannot execute — status is ${op.status}`);

    const remaining = await contract.getRemainingDelay(BigInt(opId));
    if (remaining > 0n) {
      const hrs  = Math.floor(Number(remaining) / 3600);
      const mins = Math.floor((Number(remaining) % 3600) / 60);
      throw new BadRequestException(`Timelock not expired. ${hrs}h ${mins}m remaining.`);
    }

    const tx      = await contract.execute(BigInt(opId));
    const receipt = await tx.wait();

    await this.prisma.auditLog.create({
      data: {
        userId:     executedBy,
        action:     'TREASURY_EXECUTE',
        entityType: 'Treasury',
        entityId:   opId,
        payload:    { chain, opId, txHash:receipt.hash },
      },
    });

    this.logger.log(`Treasury op ${opId} executed on ${chain}: ${receipt.hash}`);
    return { txHash:receipt.hash, status:'EXECUTED', chain, opId };
  }

  // ─── Cancel operation (guardian) ─────────────────────────────────────────────

  async cancel(chain: string, opId: string, reason: string, cancelledBy: string) {
    const { contract } = this.getContract(chain, 'guardian');

    const tx      = await contract.cancel(BigInt(opId), reason);
    const receipt = await tx.wait();

    await this.prisma.auditLog.create({
      data: {
        userId:     cancelledBy,
        action:     'TREASURY_CANCEL',
        entityType: 'Treasury',
        entityId:   opId,
        payload:    { chain, opId, reason, txHash:receipt.hash },
      },
    });

    this.logger.log(`Treasury op ${opId} cancelled on ${chain}: ${reason}`);
    return { txHash:receipt.hash, status:'CANCELLED', chain, opId, reason };
  }

  // ─── Get operation details ────────────────────────────────────────────────────

  async getOperation(chain: string, opId: string) {
    return this.getOperationDetails(chain, opId);
  }

  private async getOperationDetails(chain: string, opId: string) {
    const { contract } = this.getContractReadOnly(chain);

    const [op, remaining] = await Promise.all([
      contract.getOperation(BigInt(opId)),
      contract.getRemainingDelay(BigInt(opId)),
    ]);

    const opTypeNames = ['MINT','BURN','PAUSE','UNPAUSE'];

    return {
      opId,
      chain,
      tokenId:      op[0],
      opType:       opTypeNames[Number(op[1])] ?? 'UNKNOWN',
      target:       op[2],
      amount:       ethers.formatUnits(op[3], 6),
      reason:       op[4],
      approvals:    op[5].toString(),
      status:       OP_STATUS[Number(op[6])] ?? 'UNKNOWN',
      createdAt:    new Date(Number(op[7]) * 1000).toISOString(),
      executeAfter: op[8] > 0n ? new Date(Number(op[8]) * 1000).toISOString() : null,
      remainingDelaySeconds: remaining.toString(),
      canExecuteNow: remaining === 0n && OP_STATUS[Number(op[6])] === 'QUEUED',
    };
  }

  // ─── Get required signatures ──────────────────────────────────────────────────

  async getConfig(chain: string) {
    const { contract } = this.getContractReadOnly(chain);
    const [required, delay, opCount] = await Promise.all([
      contract.requiredSignatures(),
      contract.timelockDelay(),
      contract.opCount(),
    ]);
    return {
      chain,
      requiredSignatures:  required.toString(),
      timelockDelaySeconds:delay.toString(),
      timelockDelayHours:  (Number(delay) / 3600).toFixed(1),
      totalOperations:     opCount.toString(),
    };
  }

  // ─── Get daily limits ──────────────────────────────────────────────────────────

  async getDailyLimits(chain: string) {
    const { contract } = this.getContractReadOnly(chain);
    const results = [];
    for (const [sym, tokenId] of Object.entries(TOKEN_IDS)) {
      const [limit, minted] = await Promise.all([
        contract.dailyMintLimit(tokenId),
        contract.dailyMintedToday(tokenId),
      ]);
      results.push({
        token:           sym,
        chain,
        dailyLimit:      ethers.formatUnits(limit,  6),
        mintedToday:     ethers.formatUnits(minted, 6),
        remainingToday:  ethers.formatUnits(limit > minted ? limit - minted : 0n, 6),
      });
    }
    return results;
  }

  // ─── Reserve status from DB ────────────────────────────────────────────────────

  async getReserveStatus() {
    const entries = await this.prisma.reserveEntry.findMany({
      where:   { active:true },
      orderBy: { createdAt:'desc' },
      take:    50,
    });
    return entries;
  }

  // ─── Contract factory ──────────────────────────────────────────────────────────

  private getContract(chain: string, signerRole: string) {
    const provider = this.getProvider(chain);
    const key      = this.getSignerKey(signerRole);
    const signer   = new ethers.Wallet(key, provider);
    const address  = this.getTimelockAddress(chain);
    return {
      contract: new ethers.Contract(address, TIMELOCK_ABI, signer),
      provider,
      signer,
    };
  }

  private getContractReadOnly(chain: string) {
    const provider = this.getProvider(chain);
    const address  = this.getTimelockAddress(chain);
    return { contract: new ethers.Contract(address, TIMELOCK_ABI, provider), provider };
  }

  private getProvider(chain: string): ethers.JsonRpcProvider {
    const map: Record<string,string> = {
      ethereum: process.env.ETH_RPC!,
      bsc:      process.env.BSC_RPC!,
      polygon:  process.env.POLYGON_RPC!,
    };
    if (!map[chain]) throw new BadRequestException(`Unsupported chain: ${chain}`);
    return new ethers.JsonRpcProvider(map[chain]);
  }

  private getTimelockAddress(chain: string): string {
    const map: Record<string,string> = {
      ethereum: process.env.ETH_TREASURY_TIMELOCK_ADDRESS!,
      bsc:      process.env.BSC_TREASURY_TIMELOCK_ADDRESS!,
      polygon:  process.env.POLYGONAMOY_TREASURY_TIMELOCK_ADDRESS!,
    };
    if (!map[chain]) throw new BadRequestException(`Treasury not configured for chain: ${chain}`);
    return map[chain];
  }

  private getSignerKey(role: string): string {
    const map: Record<string,string|undefined> = {
      signer1:  process.env.SIGNER_1_PRIVATE_KEY,
      signer2:  process.env.SIGNER_2_PRIVATE_KEY,
      signer3:  process.env.SIGNER_3_PRIVATE_KEY,
      guardian: process.env.GUARDIAN_PRIVATE_KEY,
    };
    const key = map[role] || process.env.SIGNER_1_PRIVATE_KEY;
    if (!key) throw new BadRequestException(`Signer key not configured for role: ${role}`);
    return key;
  }
}
