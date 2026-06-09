import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { TronWeb } from 'tronweb';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  MintDto, BurnDto,
  TreasuryProposeDto, TreasurySignDto, TreasuryExecuteDto,
  ComplianceActionDto,
} from './dto/stablecoin.dto';
import {
  CHAIN_INFO, EVM_CHAINS, ALL_CHAINS, ALL_TOKENS, getTokenBytes32,
} from './chain.config';
import {
  TOKEN_ABI, ORACLE_MANAGER_ABI, RESERVE_VAULT_ABI, TREASURY_TIMELOCK_ABI,
} from './contract.abi';

const OP_TYPE: Record<string, number> = { MINT: 0, BURN: 1, PAUSE: 2, UNPAUSE: 3 };
const OP_STATUS: Record<number, string> = { 0: 'PENDING', 1: 'APPROVED', 2: 'QUEUED', 3: 'EXECUTED', 4: 'CANCELLED', 5: 'EXPIRED' };
const PRICE_CACHE_TTL = 60; // 1 minute

@Injectable()
export class StablecoinService {
  private readonly logger = new Logger(StablecoinService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  // ─── Token Info ───────────────────────────────────────────────

  async getTokenInfo(token: string, chain: string) {
    this.validateTokenChain(token, chain);
    const info    = CHAIN_INFO[chain];
    const address = info.tokens[token as keyof typeof info.tokens];

    if (!info.isEvm) {
      return this.getTokenInfoTron(token, chain);
    }

    const provider = this.getProvider(chain);
    const contract = new ethers.Contract(address, TOKEN_ABI, provider);

    const [supply, mintCap, paused, totalMinted, totalBurned] = await Promise.all([
      contract.totalSupply().catch(() => 0n),
      contract.mintCap().catch(() => 0n),
      contract.paused().catch(() => false),
      contract.totalMinted?.().catch(() => 0n),
      contract.totalBurned?.().catch(() => 0n),
    ]);

    const result: any = {
      token, chain, address,
      totalSupply:      ethers.formatUnits(supply, 6),
      mintCap:          ethers.formatUnits(mintCap, 6),
      paused,
    };

    if (totalMinted !== undefined) {
      result.totalMinted = ethers.formatUnits(totalMinted, 6);
      result.totalBurned = ethers.formatUnits(totalBurned, 6);
    }

    // Add live price from OracleManager
    try {
      const price = await this.getTokenPrice(token, chain);
      result.priceINR = price;
    } catch { /* non-blocking */ }

    return result;
  }

  private async getTokenInfoTron(token: string, chain: string) {
    const info    = CHAIN_INFO[chain];
    const address = info.tokens[token as keyof typeof info.tokens];
    const tronWeb = this.getTronWeb();
    const contract = await tronWeb.contract(TOKEN_ABI, address);

    const [supply, mintCap, paused] = await Promise.all([
      contract.totalSupply().call().catch(() => '0'),
      contract.mintCap().call().catch(() => '0'),
      contract.paused().call().catch(() => false),
    ]);

    return {
      token, chain, address,
      totalSupply: (Number(supply) / 1e6).toFixed(6),
      mintCap:     (Number(mintCap) / 1e6).toFixed(6),
      paused,
    };
  }

  async getTokenInfoAllChains(token: string) {
    const results = await Promise.allSettled(
      ALL_CHAINS.map(c => this.getTokenInfo(token, c)),
    );
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value);
  }

  async getTotalSupplyAllTokens() {
    const results: any[] = [];
    for (const token of ALL_TOKENS) {
      for (const chain of ALL_CHAINS) {
        try {
          results.push(await this.getTokenInfo(token, chain));
        } catch { /* skip */ }
      }
    }
    return results;
  }

  // ─── Oracle / Prices ──────────────────────────────────────────

  /**
   * Get token price from OracleManager (median of registered oracles).
   * Returns price in INR with 6 decimals.
   */
  async getTokenPrice(token: string, chain: string): Promise<{ priceINR: string; validOracles: number; cached: boolean }> {
    const cacheKey = `price:${token}:${chain}`;
    const cached   = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...parsed, cached: true };
    }

    this.validateTokenChain(token, chain);
    const info = CHAIN_INFO[chain];
    if (!info.isEvm) throw new BadRequestException('Oracle price only available on EVM chains');

    const provider = this.getProvider(chain);
    const oracle   = new ethers.Contract(info.oracleManager, ORACLE_MANAGER_ABI, provider);

    const tokenId = getTokenBytes32(token);
    const [medianPrice, validOracleCount] = await oracle.getPriceSafe(tokenId);

    const result = {
      priceINR:     ethers.formatUnits(medianPrice, 6),
      validOracles: Number(validOracleCount),
    };

    if (Number(validOracleCount) > 0) {
      await this.redis.set(cacheKey, JSON.stringify(result), PRICE_CACHE_TTL);
    }

    return { ...result, cached: false };
  }

  async getAllPrices() {
    const results: any[] = [];
    for (const token of ALL_TOKENS) {
      for (const chain of EVM_CHAINS) {
        try {
          const price = await this.getTokenPrice(token, chain);
          results.push({ token, chain, ...price });
        } catch { /* skip */ }
      }
    }
    return results;
  }

  async getOracleDetails(token: string, chain: string) {
    this.validateTokenChain(token, chain);
    const info = CHAIN_INFO[chain];
    if (!info.isEvm) throw new BadRequestException('Oracle data only available on EVM chains');

    const provider = this.getProvider(chain);
    const oracle   = new ethers.Contract(info.oracleManager, ORACLE_MANAGER_ABI, provider);
    const tokenId  = getTokenBytes32(token);

    const [addresses, names, prices, updatedAts, actives, stales] = await oracle.getOracles(tokenId);

    return addresses.map((addr: string, i: number) => ({
      address:   addr,
      name:      names[i],
      price:     ethers.formatUnits(prices[i], 6),
      updatedAt: new Date(Number(updatedAts[i]) * 1000).toISOString(),
      active:    actives[i],
      stale:     stales[i],
    }));
  }

  // ─── Reserve Vault (Proof of Reserve) ────────────────────────

  async getProofOfReserve(token: string, chain: string) {
    this.validateTokenChain(token, chain);
    const info = CHAIN_INFO[chain];
    if (!info.isEvm) throw new BadRequestException('Reserve vault only available on EVM chains');

    const provider = this.getProvider(chain);
    const vault    = new ethers.Contract(info.reserveVault, RESERVE_VAULT_ABI, provider);
    const tokenId  = getTokenBytes32(token);

    const [totalReserve, circulatingSupply, backingRatioBps, isFullyBacked, lastAuditTimestamp, lastAuditReport] =
      await vault.getProofOfReserve(tokenId);

    return {
      token, chain,
      totalReserve:      ethers.formatUnits(totalReserve, 6),
      circulatingSupply: ethers.formatUnits(circulatingSupply, 6),
      backingRatioBps:   Number(backingRatioBps),
      backingPercent:    (Number(backingRatioBps) / 100).toFixed(2) + '%',
      isFullyBacked,
      lastAuditTimestamp: lastAuditTimestamp > 0n
        ? new Date(Number(lastAuditTimestamp) * 1000).toISOString()
        : null,
      lastAuditReport: lastAuditReport || null,
    };
  }

  async getAllReservesProof() {
    const results: any[] = [];
    for (const token of ALL_TOKENS) {
      for (const chain of EVM_CHAINS) {
        try {
          results.push(await this.getProofOfReserve(token, chain));
        } catch { /* skip */ }
      }
    }
    return results;
  }

  async getActiveReserves(token: string, chain: string) {
    this.validateTokenChain(token, chain);
    const info = CHAIN_INFO[chain];
    if (!info.isEvm) throw new BadRequestException('Only available on EVM chains');

    const provider = this.getProvider(chain);
    const vault    = new ethers.Contract(info.reserveVault, RESERVE_VAULT_ABI, provider);
    const tokenId  = getTokenBytes32(token);
    const entries  = await vault.getActiveReserves(tokenId);

    const ASSET_TYPES = ['INR_BANK_DEPOSIT', 'GOLD_VAULT', 'SILVER_VAULT', 'GOVT_SECURITIES', 'USDT_COLLATERAL'];

    return entries.map((e: any) => ({
      assetType:  ASSET_TYPES[Number(e.assetType)] ?? 'UNKNOWN',
      amount:     ethers.formatUnits(e.amount, 6),
      custodian:  e.custodian,
      proofHash:  e.proofHash,
      timestamp:  new Date(Number(e.timestamp) * 1000).toISOString(),
      addedBy:    e.addedBy,
    }));
  }

  async getAuditHistory(token: string, chain: string) {
    this.validateTokenChain(token, chain);
    const info = CHAIN_INFO[chain];
    if (!info.isEvm) throw new BadRequestException('Only available on EVM chains');

    const provider = this.getProvider(chain);
    const vault    = new ethers.Contract(info.reserveVault, RESERVE_VAULT_ABI, provider);
    const tokenId  = getTokenBytes32(token);
    const records  = await vault.getAuditHistory(tokenId);

    return records.map((r: any) => ({
      timestamp:         new Date(Number(r.timestamp) * 1000).toISOString(),
      auditor:           r.auditor,
      auditorName:       r.auditorName,
      reserveAmount:     ethers.formatUnits(r.reserveAmount, 6),
      circulatingSupply: ethers.formatUnits(r.circulatingSupply, 6),
      reportHash:        r.reportHash,
      notes:             r.notes,
    }));
  }

  // ─── Treasury Timelock ────────────────────────────────────────

  async treasuryPropose(dto: TreasuryProposeDto, proposerAddress: string) {
    const info     = CHAIN_INFO[dto.chain];
    if (!info?.isEvm) throw new BadRequestException('Treasury only available on EVM chains');

    const provider = this.getProvider(dto.chain);
    const signer   = new ethers.Wallet(process.env.TREASURY_SIGNER_KEY!, provider);
    const treasury = new ethers.Contract(info.treasuryTimelock, TREASURY_TIMELOCK_ABI, signer);

    const tokenId  = getTokenBytes32(dto.token);
    const opTypeId = OP_TYPE[dto.opType];
    const amount   = dto.amount ? ethers.parseUnits(dto.amount, 6) : 0n;

    const tx      = await treasury.propose(tokenId, opTypeId, dto.target, amount, dto.reason);
    const receipt = await tx.wait();

    // Parse OperationProposed event to get opId
    const iface  = new ethers.Interface(TREASURY_TIMELOCK_ABI);
    let opId     = 0;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'OperationProposed') { opId = Number(parsed.args.opId); break; }
      } catch {}
    }

    await this.prisma.auditLog.create({
      data: {
        action: 'TREASURY_PROPOSE',
        entityType: 'TreasuryOperation',
        payload: { chain: dto.chain, token: dto.token, opType: dto.opType, target: dto.target, amount: dto.amount, opId, txHash: receipt.hash },
      },
    });

    this.logger.log(`Treasury propose: opId=${opId} chain=${dto.chain} type=${dto.opType}`);
    return { opId, txHash: receipt.hash };
  }

  async treasurySign(dto: TreasurySignDto, signerAddr: string) {
    const info     = CHAIN_INFO[dto.chain];
    if (!info?.isEvm) throw new BadRequestException('Treasury only available on EVM chains');

    const provider = this.getProvider(dto.chain);
    const signer   = new ethers.Wallet(process.env.TREASURY_SIGNER_KEY!, provider);
    const treasury = new ethers.Contract(info.treasuryTimelock, TREASURY_TIMELOCK_ABI, signer);

    const tx      = await treasury.sign(dto.opId);
    const receipt = await tx.wait();

    // Check if now queued
    const op = await this.getTreasuryOperation(dto.token, dto.chain, dto.opId);

    this.logger.log(`Treasury sign: opId=${dto.opId} chain=${dto.chain}`);
    return { txHash: receipt.hash, operation: op };
  }

  async treasuryExecute(dto: TreasuryExecuteDto, executorAddr: string) {
    const info     = CHAIN_INFO[dto.chain];
    if (!info?.isEvm) throw new BadRequestException('Treasury only available on EVM chains');

    const provider = this.getProvider(dto.chain);
    const signer   = new ethers.Wallet(process.env.TREASURY_EXECUTOR_KEY ?? process.env.TREASURY_SIGNER_KEY!, provider);
    const treasury = new ethers.Contract(info.treasuryTimelock, TREASURY_TIMELOCK_ABI, signer);

    const tx      = await treasury.execute(dto.opId);
    const receipt = await tx.wait();

    await this.prisma.auditLog.create({
      data: {
        action: 'TREASURY_EXECUTE',
        entityType: 'TreasuryOperation',
        payload: { chain: dto.chain, token: dto.token, opId: dto.opId, txHash: receipt.hash },
      },
    });

    this.logger.log(`Treasury execute: opId=${dto.opId} chain=${dto.chain} tx=${receipt.hash}`);
    return { txHash: receipt.hash };
  }

  async getTreasuryOperation(token: string, chain: string, opId: number) {
    const info     = CHAIN_INFO[chain];
    if (!info?.isEvm) throw new BadRequestException('Treasury only available on EVM chains');

    const provider = this.getProvider(chain);
    const treasury = new ethers.Contract(info.treasuryTimelock, TREASURY_TIMELOCK_ABI, provider);

    const [tokenId, opType, target, amount, reason, approvals, status, createdAt, executeAfter] =
      await treasury.getOperation(opId);

    const remaining = await treasury.getRemainingDelay(opId);
    const OP_TYPES  = ['MINT', 'BURN', 'PAUSE', 'UNPAUSE'];

    return {
      opId, token, chain,
      tokenId,
      opType:       OP_TYPES[Number(opType)] ?? 'UNKNOWN',
      target,
      amount:       ethers.formatUnits(amount, 6),
      reason,
      approvals:    Number(approvals),
      status:       OP_STATUS[Number(status)] ?? 'UNKNOWN',
      createdAt:    new Date(Number(createdAt) * 1000).toISOString(),
      executeAfter: executeAfter > 0n ? new Date(Number(executeAfter) * 1000).toISOString() : null,
      remainingDelaySec: Number(remaining),
    };
  }

  async getTreasuryConfig(chain: string) {
    const info     = CHAIN_INFO[chain];
    if (!info?.isEvm) throw new BadRequestException('Treasury only available on EVM chains');

    const provider = this.getProvider(chain);
    const treasury = new ethers.Contract(info.treasuryTimelock, TREASURY_TIMELOCK_ABI, provider);

    const [required, delay] = await Promise.all([
      treasury.requiredSignatures(),
      treasury.timelockDelay(),
    ]);

    const limits: any = {};
    for (const token of ALL_TOKENS) {
      const tokenId = getTokenBytes32(token);
      const [limit, minted] = await Promise.all([
        treasury.dailyMintLimit(tokenId).catch(() => 0n),
        treasury.dailyMintedToday(tokenId).catch(() => 0n),
      ]);
      limits[token] = {
        dailyLimit: ethers.formatUnits(limit, 6),
        mintedToday: ethers.formatUnits(minted, 6),
      };
    }

    return {
      chain,
      contractAddress:    info.treasuryTimelock,
      requiredSignatures: Number(required),
      timelockDelayHours: Number(delay) / 3600,
      dailyLimits:        limits,
    };
  }

  // ─── Direct Mint / Burn (requires MINTER_ROLE / BURNER_ROLE) ─

  /**
   * Direct mint via token contract.
   * The MINTER_ROLE private key must be set in env (MINTER_PRIVATE_KEY).
   * For production use treasury timelock instead.
   */
  async mintTokens(dto: MintDto, requestedBy: string) {
    this.validateTokenChain(dto.token, dto.chain);
    const info    = CHAIN_INFO[dto.chain];
    const address = info.tokens[dto.token as keyof typeof info.tokens];

    if (!info.isEvm) {
      return this.mintTokensTron(dto, requestedBy);
    }

    const provider = this.getProvider(dto.chain);
    const signer   = new ethers.Wallet(process.env.MINTER_PRIVATE_KEY!, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);

    const isPaused = await contract.paused();
    if (isPaused) throw new BadRequestException(`${dto.token} is paused on ${dto.chain}`);

    const parsed = ethers.parseUnits(dto.amount, 6);
    const tx     = await contract.mint(dto.toAddress, parsed, dto.reason);
    const receipt = await tx.wait();

    await this.recordTransaction({
      txHash: receipt.hash, chain: dto.chain, type: 'MINT',
      amount: dto.amount, tokenSymbol: dto.token,
      fromAddress: 'treasury', toAddress: dto.toAddress,
    });
    await this.recordAudit(requestedBy, 'MINT_TOKENS', address, {
      ...dto, txHash: receipt.hash,
    });

    this.logger.log(`Minted ${dto.amount} ${dto.token} → ${dto.toAddress} on ${dto.chain}: ${receipt.hash}`);
    return { txHash: receipt.hash, status: 'CONFIRMED' };
  }

  async burnTokens(dto: BurnDto, requestedBy: string) {
    this.validateTokenChain(dto.token, dto.chain);
    const info    = CHAIN_INFO[dto.chain];
    const address = info.tokens[dto.token as keyof typeof info.tokens];

    if (!info.isEvm) {
      return this.burnTokensTron(dto, requestedBy);
    }

    const provider = this.getProvider(dto.chain);
    const signer   = new ethers.Wallet(process.env.BURNER_PRIVATE_KEY!, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);

    const parsed  = ethers.parseUnits(dto.amount, 6);
    const tx      = await contract.burn(dto.fromAddress, parsed, dto.reason);
    const receipt = await tx.wait();

    await this.recordTransaction({
      txHash: receipt.hash, chain: dto.chain, type: 'BURN',
      amount: dto.amount, tokenSymbol: dto.token,
      fromAddress: dto.fromAddress, toAddress: 'treasury',
    });
    await this.recordAudit(requestedBy, 'BURN_TOKENS', address, {
      ...dto, txHash: receipt.hash,
    });

    this.logger.log(`Burned ${dto.amount} ${dto.token} from ${dto.fromAddress} on ${dto.chain}: ${receipt.hash}`);
    return { txHash: receipt.hash, status: 'CONFIRMED' };
  }

  private async mintTokensTron(dto: MintDto, requestedBy: string) {
    const info     = CHAIN_INFO['tron'];
    const address  = info.tokens[dto.token as keyof typeof info.tokens];
    const tronWeb  = this.getTronWeb();
    const contract = await tronWeb.contract(TOKEN_ABI, address);
    const amountMicro = BigInt(Math.round(parseFloat(dto.amount) * 1_000_000)).toString();

    const txId = await contract.mint(dto.toAddress, amountMicro, dto.reason)
      .send({ feeLimit: 100_000_000 });

    await this.recordAudit(requestedBy, 'MINT_TOKENS_TRON', address, { ...dto, txHash: txId });
    return { txHash: txId, status: 'CONFIRMED' };
  }

  private async burnTokensTron(dto: BurnDto, requestedBy: string) {
    const info     = CHAIN_INFO['tron'];
    const address  = info.tokens[dto.token as keyof typeof info.tokens];
    const tronWeb  = this.getTronWeb();
    const contract = await tronWeb.contract(TOKEN_ABI, address);
    const amountMicro = BigInt(Math.round(parseFloat(dto.amount) * 1_000_000)).toString();

    const txId = await contract.burn(dto.fromAddress, amountMicro, dto.reason)
      .send({ feeLimit: 100_000_000 });

    await this.recordAudit(requestedBy, 'BURN_TOKENS_TRON', address, { ...dto, txHash: txId });
    return { txHash: txId, status: 'CONFIRMED' };
  }

  // ─── Compliance ───────────────────────────────────────────────

  async blacklistAddress(dto: ComplianceActionDto, requestedBy: string) {
    const info    = CHAIN_INFO[dto.chain];
    if (!info?.isEvm) throw new BadRequestException('Only available on EVM chains');
    const address = info.tokens[dto.token as keyof typeof info.tokens];

    const provider = this.getProvider(dto.chain);
    const signer   = new ethers.Wallet(process.env.COMPLIANCE_KEY!, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);

    const tx      = await contract.blacklist(dto.address, dto.status);
    const receipt = await tx.wait();

    await this.recordAudit(requestedBy, dto.status ? 'BLACKLIST_ADD' : 'BLACKLIST_REMOVE', address, dto);
    return { txHash: receipt.hash, blacklisted: dto.status };
  }

  async freezeAddress(dto: ComplianceActionDto, requestedBy: string) {
    const info    = CHAIN_INFO[dto.chain];
    if (!info?.isEvm) throw new BadRequestException('Only available on EVM chains');
    const address = info.tokens[dto.token as keyof typeof info.tokens];

    const provider = this.getProvider(dto.chain);
    const signer   = new ethers.Wallet(process.env.COMPLIANCE_KEY!, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);

    const tx      = await contract.freeze(dto.address, dto.status);
    const receipt = await tx.wait();

    await this.recordAudit(requestedBy, dto.status ? 'FREEZE_ADD' : 'FREEZE_REMOVE', address, dto);
    return { txHash: receipt.hash, frozen: dto.status };
  }

  async checkCompliance(token: string, chain: string, address: string) {
    this.validateTokenChain(token, chain);
    const info        = CHAIN_INFO[chain];
    if (!info.isEvm)  return { address, blacklisted: false, frozen: false, note: 'TRON compliance not queried via this service' };

    const tokenAddr  = info.tokens[token as keyof typeof info.tokens];
    const provider   = this.getProvider(chain);
    const contract   = new ethers.Contract(tokenAddr, TOKEN_ABI, provider);

    const [blacklisted, frozen] = await Promise.all([
      contract.isBlacklisted(address).catch(() => false),
      contract.isFrozen(address).catch(() => false),
    ]);

    return { token, chain, address, blacklisted, frozen };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private validateTokenChain(token: string, chain: string) {
    if (!ALL_TOKENS.includes(token)) throw new BadRequestException(`Unsupported token: ${token}`);
    if (!ALL_CHAINS.includes(chain)) throw new BadRequestException(`Unsupported chain: ${chain}`);
  }

  private getProvider(chain: string): ethers.JsonRpcProvider {
    const info   = CHAIN_INFO[chain];
    const rpcUrl = process.env[info.rpcEnvKey];
    if (!rpcUrl) throw new BadRequestException(`Missing RPC URL. Set ${info.rpcEnvKey} in env`);
    return new ethers.JsonRpcProvider(rpcUrl);
  }

  private getTronWeb(): TronWeb {
    return new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: process.env.TRON_ADMIN_KEY!,
    });
  }

  private async recordTransaction(data: {
    txHash: string; chain: string; type: string;
    amount: string; tokenSymbol: string;
    fromAddress: string; toAddress: string;
  }) {
    await this.prisma.transaction.create({
      data: {
        walletId:    'system',
        txHash:      data.txHash,
        chain:       data.chain,
        type:        data.type as any,
        amount:      data.amount,
        tokenSymbol: data.tokenSymbol,
        fromAddress: data.fromAddress,
        toAddress:   data.toAddress,
        status:      'CONFIRMED',
        confirmedAt: new Date(),
      },
    }).catch(e => this.logger.warn('recordTransaction failed:', e.message));
  }

  private async recordAudit(userId: string | undefined, action: string, entityId: string, payload: any) {
    await this.prisma.auditLog.create({
      data: {
        userId: userId ?? undefined,
        action,
        entityType: 'Token',
        entityId,
        payload,
      },
    }).catch(e => this.logger.warn('recordAudit failed:', e.message));
  }
}
