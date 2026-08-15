import {
  Injectable, Logger, NotFoundException,
  BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { ethers }         from 'ethers';
import { PrismaService }  from '../prisma/prisma.service';
import { RedisService }   from '../redis/redis.service';
import { AddReserveDto }  from './dto/add-reserve.dto';
import { RecordAuditDto } from './dto/record-audit.dto';

const RESERVE_VAULT_ABI = [
  'function addReserve(bytes32 tokenId, uint8 assetType, uint256 amount, string custodian, string proofHash) returns (uint256)',
  'function deactivateReserve(uint256 entryId, string reason)',
  'function recordAudit(bytes32 tokenId, uint256 reserveAmount, uint256 circulatingSupply, string auditorName, string reportHash, string notes) returns (uint256)',
  'function getProofOfReserve(bytes32 tokenId) view returns (uint256 totalReserve, uint256 circulatingSupply, uint256 backingRatioBps, bool isFullyBacked, uint256 lastAuditTimestamp, string lastAuditReport)',
  'function getActiveReserves(bytes32 tokenId) view returns (tuple(bytes32 tokenId, uint8 assetType, uint256 amount, string custodian, string proofHash, uint256 timestamp, address addedBy, bool active)[])',
  'function getAuditHistory(bytes32 tokenId) view returns (tuple(uint256 timestamp, address auditor, string auditorName, bytes32 tokenId, uint256 reserveAmount, uint256 circulatingSupply, string reportHash, string notes)[])',
  'event ReserveAdded(uint256 indexed entryId, bytes32 indexed tokenId, uint8 assetType, uint256 amount, string custodian, string proofHash)',
];

const TOKEN_IDS: Record<string,string> = {
  INRX:  ethers.keccak256(ethers.toUtf8Bytes('INRX')),
  EGOLD: ethers.keccak256(ethers.toUtf8Bytes('EGOLD')),
  ESLVR: ethers.keccak256(ethers.toUtf8Bytes('ESLVR')),
};

const ASSET_TYPE_MAP: Record<string,number> = {
  INR_BANK_DEPOSIT:0, GOLD_VAULT:1, SILVER_VAULT:2, GOVT_SECURITIES:3, USDT_COLLATERAL:4,
};

@Injectable()
export class ReserveService {
  private readonly logger = new Logger(ReserveService.name);
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  async addEntry(dto: AddReserveDto, addedBy: string) {
    const vaultAddress = this.getVaultAddress(dto.chain);
    const custodianKey = process.env.CUSTODIAN_PRIVATE_KEY;
    if (!custodianKey) throw new ForbiddenException('CUSTODIAN_PRIVATE_KEY not set in root .env');

    const provider  = this.getProvider(dto.chain);
    const signer    = new ethers.Wallet(custodianKey, provider);
    const vault     = new ethers.Contract(vaultAddress, RESERVE_VAULT_ABI, signer);
    const tokenId   = TOKEN_IDS[dto.token];
    const assetType = ASSET_TYPE_MAP[dto.assetType];
    const amount    = ethers.parseUnits(dto.amount, 6);

    const tx      = await vault.addReserve(tokenId, assetType, amount, dto.custodian, dto.proofHash ?? '');
    const receipt = await tx.wait();

    // Parse entryId from event
    const iface = new ethers.Interface(RESERVE_VAULT_ABI);
    let onChainId = '0';
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'ReserveAdded') { onChainId = parsed.args.entryId.toString(); break; }
      } catch {}
    }

    // Mirror in DB
    const treasury = await this.prisma.treasury.upsert({
      where:  { token: dto.token },
      create: { token: dto.token, totalSupply:'0', reserveAmount:'0', collateralRatio:'0' },
      update: {},
    });

    const entry = await this.prisma.reserveEntry.create({
      data: {
        treasuryId: treasury.id,
        assetType:  dto.assetType,
        amount:     dto.amount,
        custodian:  dto.custodian,
        proofUrl:   dto.proofUrl,
        verifiedAt: new Date(),
      },
    });

    await this.recalculateRatio(dto.token);
    await this.redis.del(`reserve:proof:${dto.token}:${dto.chain}`);

    await this.prisma.auditLog.create({
      data: { userId:addedBy, action:'ADD_RESERVE_ENTRY', entityType:'Reserve', entityId:entry.id,
              payload:{ chain:dto.chain, token:dto.token, amount:dto.amount, custodian:dto.custodian, txHash:receipt.hash, onChainId } },
    });

    this.logger.log(`Reserve entry added: ${dto.token} ${dto.amount} on ${dto.chain}`);
    return { ...entry, txHash:receipt.hash, onChainEntryId:onChainId };
  }

  async deactivateEntry(chain: string, entryId: number, reason: string, by: string) {
    const vaultAddress = this.getVaultAddress(chain);
    const custodianKey = process.env.CUSTODIAN_PRIVATE_KEY;
    if (!custodianKey) throw new ForbiddenException('CUSTODIAN_PRIVATE_KEY not set');
    const signer  = new ethers.Wallet(custodianKey, this.getProvider(chain));
    const vault   = new ethers.Contract(vaultAddress, RESERVE_VAULT_ABI, signer);
    const tx      = await vault.deactivateReserve(entryId, reason);
    const receipt = await tx.wait();
    await this.prisma.auditLog.create({
      data: { userId:by, action:'DEACTIVATE_RESERVE', entityType:'Reserve', entityId:entryId.toString(),
              payload:{ chain, entryId, reason, txHash:receipt.hash } },
    });
    return { txHash:receipt.hash, entryId, reason };
  }

  async recordAudit(dto: RecordAuditDto, recordedBy: string) {
    const vaultAddress = this.getVaultAddress(dto.chain);
    const auditorKey   = process.env.AUDITOR_PRIVATE_KEY;
    if (!auditorKey) throw new ForbiddenException('AUDITOR_PRIVATE_KEY not set');
    const signer  = new ethers.Wallet(auditorKey, this.getProvider(dto.chain));
    const vault   = new ethers.Contract(vaultAddress, RESERVE_VAULT_ABI, signer);
    const tx      = await vault.recordAudit(
      TOKEN_IDS[dto.token],
      ethers.parseUnits(dto.reserveAmount, 6),
      ethers.parseUnits(dto.circulatingSupply, 6),
      dto.auditorName, dto.reportHash, dto.notes,
    );
    const receipt = await tx.wait();
    await this.prisma.auditLog.create({
      data: { userId:recordedBy, action:'RECORD_AUDIT', entityType:'Reserve', entityId:dto.reportHash,
              payload:{ chain:dto.chain, token:dto.token, auditorName:dto.auditorName, txHash:receipt.hash } },
    });
    this.logger.log(`Audit recorded for ${dto.token} on ${dto.chain}`);
    return { txHash:receipt.hash, token:dto.token, chain:dto.chain, reportHash:dto.reportHash };
  }

  async getProofOfReserve(token: string, chain: string) {
    const cacheKey = `reserve:proof:${token}:${chain}`;
    const cached   = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const vault   = new ethers.Contract(this.getVaultAddress(chain), RESERVE_VAULT_ABI, this.getProvider(chain));
    const proof   = await vault.getProofOfReserve(TOKEN_IDS[token]);
    const result  = {
      token, chain,
      totalReserve:      ethers.formatUnits(proof[0], 6),
      circulatingSupply: ethers.formatUnits(proof[1], 6),
      backingRatioBps:   proof[2].toString(),
      backingRatioPct:   (Number(proof[2]) / 100).toFixed(2) + '%',
      isFullyBacked:     proof[3],
      lastAuditAt:       proof[4] > 0n ? new Date(Number(proof[4])*1000).toISOString() : null,
      lastAuditReport:   proof[5] || null,
      checkedAt:         new Date().toISOString(),
      vaultAddress:      this.getVaultAddress(chain),
    };
    await this.redis.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }

  async getProofAllChains(token: string) {
    const results = await Promise.allSettled(
      ['ethereum','bsc','polygon'].map(c => this.getProofOfReserve(token, c))
    );
    return results.filter(r=>r.status==='fulfilled').map(r=>(r as any).value);
  }

  async getActiveReserves(token: string, chain: string) {
    const vault    = new ethers.Contract(this.getVaultAddress(chain), RESERVE_VAULT_ABI, this.getProvider(chain));
    const reserves = await vault.getActiveReserves(TOKEN_IDS[token]);
    const names    = ['INR_BANK_DEPOSIT','GOLD_VAULT','SILVER_VAULT','GOVT_SECURITIES','USDT_COLLATERAL'];
    return reserves.map((r:any,i:number)=>({
      entryId: i,
      assetType: names[Number(r[1])]??'UNKNOWN',
      amount: ethers.formatUnits(r[2],6),
      custodian: r[3], proofHash: r[4],
      timestamp: new Date(Number(r[5])*1000).toISOString(),
      addedBy: r[6],
    }));
  }

  async getAuditHistory(token: string, chain: string) {
    const vault   = new ethers.Contract(this.getVaultAddress(chain), RESERVE_VAULT_ABI, this.getProvider(chain));
    const records = await vault.getAuditHistory(TOKEN_IDS[token]);
    return records.map((r:any)=>({
      timestamp:         new Date(Number(r[0])*1000).toISOString(),
      auditor:           r[1], auditorName:r[2],
      reserveAmount:     ethers.formatUnits(r[4],6),
      circulatingSupply: ethers.formatUnits(r[5],6),
      reportHash: r[6], notes: r[7],
    }));
  }

  async getHealthStatus() {
    const tokens = ['INRX','EGOLD','ESLVR'];
    const chains = ['ethereum','bsc','polygon'];
    const results = await Promise.allSettled(
      tokens.flatMap(t => chains.map(c => this.getProofOfReserve(t, c)))
    );
    const entries = results.filter(r=>r.status==='fulfilled').map(r=>(r as any).value);
    return {
      allHealthy: entries.every(e=>e.isFullyBacked),
      status:     entries.every(e=>e.isFullyBacked) ? 'HEALTHY' : 'WARNING',
      summary:    entries,
      checkedAt:  new Date().toISOString(),
    };
  }

  async getDBProof(token: string) {
    const treasury = await this.prisma.treasury.findUnique({
      where:   { token },
      include: { reserveEntries:{ orderBy:{ verifiedAt:'desc' } } },
    });
    if (!treasury) throw new NotFoundException(`No treasury record for ${token}`);
    return {
      token,
      totalSupply:     treasury.totalSupply.toString(),
      reserveAmount:   treasury.reserveAmount.toString(),
      collateralRatio: treasury.collateralRatio.toString(),
      isHealthy:       parseFloat(treasury.collateralRatio.toString()) >= 1.0,
      entries:         treasury.reserveEntries,
      checkedAt:       new Date().toISOString(),
    };
  }

  private async recalculateRatio(token: string) {
    const treasury = await this.prisma.treasury.findUnique({
      where:   { token },
      include: { reserveEntries:true },
    });
    if (!treasury) return;
    const totalReserve = treasury.reserveEntries.reduce((s,e)=>s+parseFloat(e.amount.toString()),0);
    const supply = parseFloat(treasury.totalSupply.toString());
    const ratio  = supply > 0 ? totalReserve / supply : 0;
    await this.prisma.treasury.update({ where:{ token }, data:{ reserveAmount:totalReserve.toString(), collateralRatio:ratio.toString() } });
  }

  private getProvider(chain: string) {
    const map: Record<string,string> = { ethereum:process.env.ETH_RPC!, bsc:process.env.BSC_RPC!, polygon:process.env.POLYGON_RPC! };
    if (!map[chain]) throw new BadRequestException(`Unsupported chain: ${chain}`);
    return new ethers.JsonRpcProvider(map[chain]);
  }

  private getVaultAddress(chain: string) {
    const map: Record<string,string|undefined> = {
      ethereum: process.env.ETH_RESERVE_VAULT_ADDRESS,
      bsc:      process.env.BSC_RESERVE_VAULT_ADDRESS,
      polygon:  process.env.POLYGON_RESERVE_VAULT_ADDRESS,
    };
    if (!map[chain]) throw new BadRequestException(`ReserveVault not configured for: ${chain}`);
    return map[chain]!;
  }
}
