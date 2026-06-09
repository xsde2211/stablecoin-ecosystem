import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ethers } from 'ethers';
import { TronWeb } from 'tronweb';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { InitiateBridgeDto, BurnBridgeDto, ValidatorSignatureDto } from './dto/bridge.dto';
import { CHAIN_CONFIGS, EVM_CHAINS, getTokenId } from './chain.config';
import { BRIDGE_V2_ABI, ERC20_ABI } from './bridge.abi';

const REQUIRED_CONFIRMATIONS = 2; // matches requiredValidators in deployed contracts

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    @InjectQueue('bridge') private bridgeQueue: Queue,
  ) {}

  // ─── Initiate (Lock) ──────────────────────────────────────────

  /**
   * Called by frontend when user wants to bridge tokens.
   * Records the transfer intent and queues the lock transaction.
   *
   * NOTE: The actual lock() tx on-chain is called by the RELAYER
   * after user has approved the bridge contract to spend their tokens.
   * This endpoint creates the transfer record and returns the data
   * the frontend needs to call lock() directly, OR queues a relayer-assisted lock.
   */
  async initiate(userId: string, srcWalletAddress: string, dto: InitiateBridgeDto) {
    if (dto.srcChain === dto.dstChain) {
      throw new BadRequestException('Source and destination chains must differ');
    }
    if (!CHAIN_CONFIGS[dto.srcChain] || !CHAIN_CONFIGS[dto.dstChain]) {
      throw new BadRequestException(`Unsupported chain: ${dto.srcChain} or ${dto.dstChain}`);
    }

    const nonce    = Date.now();
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    // Validate amount
    const amountNum = parseFloat(dto.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    const transfer = await this.prisma.bridgeTransfer.create({
      data: {
        userId,
        srcChain:   dto.srcChain,
        dstChain:   dto.dstChain,
        srcAddress: srcWalletAddress,
        dstAddress: dto.dstAddress,
        amount:     dto.amount,
        token:      dto.token,
        nonce:      nonce.toString(),
        deadline:   new Date(deadline * 1000),
        status:     'PENDING',
      },
    });

    // Queue relayer-side lock (for custodial wallets)
    // For non-custodial, user calls lock() directly and we just track
    await this.bridgeQueue.add(
      'lock-tokens',
      {
        transferId:       transfer.id,
        userId,
        srcWalletAddress,
        srcChain:         dto.srcChain,
        dstChain:         dto.dstChain,
        token:            dto.token,
        amount:           dto.amount,
        dstAddress:       dto.dstAddress,
        nonce,
        deadline,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    this.logger.log(`Bridge initiated: ${transfer.id} — ${dto.amount} ${dto.token} ${dto.srcChain}→${dto.dstChain}`);

    // Return transfer + data for frontend to call lock() itself if non-custodial
    const srcConfig = CHAIN_CONFIGS[dto.srcChain];
    const tokenId   = getTokenId(dto.token);
    const dstChainId = CHAIN_CONFIGS[dto.dstChain]?.chainId ?? 0;

    return {
      transfer,
      lockCalldata: {
        bridgeAddress: srcConfig.bridgeAddress,
        tokenId,
        amount:        ethers.parseUnits(dto.amount, 6).toString(),
        dstChainId,
        dstRecipient:  dto.dstAddress,
        nonce:         nonce.toString(),
        deadline:      deadline.toString(),
      },
    };
  }

  // ─── Burn (Reverse bridge) ────────────────────────────────────

  /**
   * User wants to return bridged tokens back to the original chain.
   * Creates a burn transfer record; user calls burn() on-chain.
   */
  async initiateBurn(userId: string, dstWalletAddress: string, dto: BurnBridgeDto) {
    if (dto.srcChain === dto.dstChain) {
      throw new BadRequestException('Chains must differ');
    }

    const nonce    = Date.now();
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const transfer = await this.prisma.bridgeTransfer.create({
      data: {
        userId,
        srcChain:   dto.srcChain,
        dstChain:   dto.dstChain,
        srcAddress: dto.srcRecipient,
        dstAddress: dstWalletAddress,
        amount:     dto.amount,
        token:      dto.token,
        nonce:      nonce.toString(),
        deadline:   new Date(deadline * 1000),
        status:     'PENDING',
      },
    });

    await this.bridgeQueue.add(
      'burn-tokens',
      { transferId: transfer.id, userId, dstWalletAddress, ...dto, nonce, deadline },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    const dstConfig = CHAIN_CONFIGS[dto.dstChain];
    const tokenId   = getTokenId(dto.token);
    const srcChainId = CHAIN_CONFIGS[dto.srcChain]?.chainId ?? 0;

    return {
      transfer,
      burnCalldata: {
        bridgeAddress: dstConfig.bridgeAddress,
        tokenId,
        amount:       ethers.parseUnits(dto.amount, 6).toString(),
        srcChainId,
        srcRecipient: dto.srcRecipient,
        nonce:        nonce.toString(),
        deadline:     deadline.toString(),
      },
    };
  }

  // ─── Validator signature collection ──────────────────────────

  /**
   * Validators call this endpoint with their signature for a transfer.
   * When requiredValidators threshold is met, relayer executes mint/unlock.
   */
  async submitValidatorSignature(dto: ValidatorSignatureDto) {
    const transfer = await this.prisma.bridgeTransfer.findUnique({
      where:   { id: dto.transferId },
      include: { validatorSignatures: true },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (!['PENDING', 'LOCKED'].includes(transfer.status)) {
      throw new BadRequestException(`Transfer status ${transfer.status} does not accept signatures`);
    }

    // Idempotent — skip duplicate validator
    const already = transfer.validatorSignatures.find(
      s => s.validatorAddr.toLowerCase() === dto.validatorAddress.toLowerCase(),
    );
    if (already) return { message: 'Already submitted', transfer };

    await this.prisma.validatorSignature.create({
      data: {
        transferId:    dto.transferId,
        validatorAddr: dto.validatorAddress,
        signature:     dto.signature,
      },
    });

    const totalSigs = transfer.validatorSignatures.length + 1;

    if (totalSigs >= REQUIRED_CONFIRMATIONS) {
      await this.prisma.bridgeTransfer.update({
        where: { id: dto.transferId },
        data:  {
          status:        'SIGNATURES_COLLECTED',
          confirmations: totalSigs,
        },
      });
      // Queue relayer to execute mint/unlock on destination
      await this.bridgeQueue.add(
        'execute-mint',
        { transferId: dto.transferId },
        { attempts: 5, backoff: { type: 'exponential', delay: 10000 } },
      );
      this.logger.log(`Signatures collected for ${dto.transferId} — queuing mint`);
    } else {
      await this.prisma.bridgeTransfer.update({
        where: { id: dto.transferId },
        data:  { confirmations: totalSigs },
      });
    }

    return { message: 'Signature accepted', signaturesCollected: totalSigs, required: REQUIRED_CONFIRMATIONS };
  }

  // ─── Execute Mint (called by relayer via queue) ───────────────

  async executeMint(transferId: string) {
    const transfer = await this.prisma.bridgeTransfer.findUnique({
      where:   { id: transferId },
      include: { validatorSignatures: true },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'SIGNATURES_COLLECTED') {
      throw new BadRequestException('Transfer not ready for mint');
    }

    const signatures = transfer.validatorSignatures.map(s => s.signature);
    const dstConfig  = CHAIN_CONFIGS[transfer.dstChain];
    const srcConfig  = CHAIN_CONFIGS[transfer.srcChain];

    if (!dstConfig) throw new BadRequestException(`Unsupported destination chain: ${transfer.dstChain}`);

    let dstTxHash: string;

    if (dstConfig.isEvm) {
      dstTxHash = await this.executeMintEvm(transfer, signatures, dstConfig, srcConfig);
    } else {
      dstTxHash = await this.executeMintTron(transfer, signatures);
    }

    await this.prisma.bridgeTransfer.update({
      where: { id: transferId },
      data:  { status: 'COMPLETED', dstTxHash },
    });

    this.logger.log(`Bridge mint completed: ${dstTxHash}`);
    return { txHash: dstTxHash };
  }

  private async executeMintEvm(transfer: any, signatures: string[], dstConfig: any, srcConfig: any): Promise<string> {
    const rpcUrl  = process.env[dstConfig.rpcEnvKey];
    if (!rpcUrl) throw new Error(`Missing RPC URL for ${transfer.dstChain}: set ${dstConfig.rpcEnvKey}`);

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const relayer  = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridge   = new ethers.Contract(dstConfig.bridgeAddress, BRIDGE_V2_ABI, relayer);

    const tokenId    = getTokenId(transfer.token);
    const srcChainId = srcConfig?.chainId ?? 0;
    const dstChainId = dstConfig.chainId;

    const req = {
      tokenId,
      from:       transfer.srcAddress,
      to:         transfer.dstAddress,
      amount:     ethers.parseUnits(transfer.amount, 6),
      srcChainId,
      dstChainId,
      nonce:      BigInt(transfer.nonce),
      deadline:   Math.floor(transfer.deadline.getTime() / 1000),
    };

    const tx      = await bridge.mint(req, signatures);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  private async executeMintTron(transfer: any, signatures: string[]): Promise<string> {
    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: process.env.RELAYER_TRON_PRIVATE_KEY!,
    });
    const bridge = await tronWeb.contract().at(CHAIN_CONFIGS.tron.bridgeAddress);

    const amountMicro = BigInt(parseFloat(transfer.amount) * 1_000_000).toString();
    const srcNonce    = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256'],
        [transfer.nonce, transfer.nonce],
      ),
    );

    const txId = await bridge.mintTokens(
      transfer.token,
      transfer.dstAddress,
      amountMicro,
      transfer.srcChain,
      srcNonce,
      signatures,
    ).send({ feeLimit: 200_000_000 });

    return txId;
  }

  // ─── On-chain confirmation (webhook from listener-service) ────

  /**
   * Called by listener-service when it detects a TokensLocked event.
   * Updates transfer status to LOCKED and records source tx hash.
   */
  async confirmLock(srcTxHash: string, chain: string, nonce: string) {
    const transfer = await this.prisma.bridgeTransfer.findFirst({
      where: { nonce, srcChain: chain, status: 'PENDING' },
    });
    if (!transfer) {
      this.logger.warn(`No pending transfer found for nonce=${nonce} chain=${chain}`);
      return;
    }
    await this.prisma.bridgeTransfer.update({
      where: { id: transfer.id },
      data:  { status: 'LOCKED', srcTxHash },
    });
    this.logger.log(`Transfer ${transfer.id} locked — txHash: ${srcTxHash}`);
    return transfer;
  }

  // ─── Get bridge fee estimate ──────────────────────────────────

  async estimateFee(srcChain: string, dstChain: string, token: string, amount: string) {
    // Fee structure: 0.1% bridge fee + gas estimate
    const bridgeFeeRate = 0.001;
    const amountNum     = parseFloat(amount);
    const bridgeFee     = (amountNum * bridgeFeeRate).toFixed(6);

    // Gas estimates (in USD equivalent)
    const gasEstimates: Record<string, number> = {
      sepolia: 0.5,
      bsc:     0.1,
      polygon: 0.05,
      tron:    0.2,
    };

    const srcGas = gasEstimates[srcChain] ?? 0.5;
    const dstGas = gasEstimates[dstChain] ?? 0.5;

    return {
      bridgeFee,
      estimatedGasUsd: (srcGas + dstGas).toFixed(2),
      estimatedTimeMin: srcChain === 'tron' || dstChain === 'tron' ? 5 : 3,
      youReceive: (amountNum - parseFloat(bridgeFee)).toFixed(6),
    };
  }

  // ─── Query ────────────────────────────────────────────────────

  async getTransfer(id: string) {
    const t = await this.prisma.bridgeTransfer.findUnique({
      where:   { id },
      include: { validatorSignatures: true },
    });
    if (!t) throw new NotFoundException('Transfer not found');
    return t;
  }

  async getUserTransfers(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.bridgeTransfer.findMany({
        where:   { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
        include: { validatorSignatures: { select: { validatorAddr: true, signedAt: true } } },
      }),
      this.prisma.bridgeTransfer.count({ where: { userId } }),
    ]);
    return { data, total, page, limit };
  }

  async getTransfersByStatus(status: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.bridgeTransfer.findMany({
        where:   { status },
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
      }),
      this.prisma.bridgeTransfer.count({ where: { status } }),
    ]);
    return { data, total, page, limit };
  }

  /** Get all supported chains and tokens */
  getSupportedRoutes() {
    const routes: any[] = [];
    const chains = Object.keys(CHAIN_CONFIGS);
    for (const src of chains) {
      for (const dst of chains) {
        if (src !== dst) {
          routes.push({
            srcChain: src,
            dstChain: dst,
            tokens:   ['INRX', 'EGOLD', 'ESLVR'],
          });
        }
      }
    }
    return { chains, routes };
  }

  /** Check if nonce is already processed on a specific chain's bridge */
  async isNonceProcessed(chain: string, srcChainId: number, nonce: string): Promise<boolean> {
    const config = CHAIN_CONFIGS[chain];
    if (!config || !config.isEvm) return false;

    const rpcUrl = process.env[config.rpcEnvKey];
    if (!rpcUrl) return false;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const bridge   = new ethers.Contract(config.bridgeAddress, BRIDGE_V2_ABI, provider);

    const nonceKey = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [srcChainId, nonce]),
    );

    return bridge.isNonceProcessed(nonceKey);
  }
}
