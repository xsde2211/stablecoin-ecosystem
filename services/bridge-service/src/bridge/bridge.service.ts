import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue }       from 'bull';
import { ethers }      from 'ethers';
import { TronWeb }     from 'tronweb';
import { PrismaService }      from '../prisma/prisma.service';
import { InitiateBridgeDto }  from './dto/initiate-bridge.dto';

const BRIDGE_ABI = [
  'function lock(uint256 amount, uint256 dstChainId, uint256 nonce, uint256 deadline)',
  'event TokensLocked(address indexed from, uint256 amount, uint256 dstChainId, uint256 nonce)',
];

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);

  private readonly chainIds: Record<string, number> = {
    ethereum: 1,        bsc: 56,
    polygon:  137,      tron: 728126428,
    solana:   0,        sepolia: 11155111,
  };

  constructor(
    private prisma: PrismaService,
    @InjectQueue('bridge') private bridgeQueue: Queue,
  ) {}

  // ─── Initiate ────────────────────────────────────────────────────

  async initiate(userId: string, walletAddress: string, dto: InitiateBridgeDto) {
    if (dto.srcChain === dto.dstChain) {
      throw new BadRequestException('Source and destination chains must differ');
    }

    const nonce    = Date.now();
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const transfer = await this.prisma.bridgeTransfer.create({
      data: {
        userId,
        srcChain:   dto.srcChain,
        dstChain:   dto.dstChain,
        srcAddress: walletAddress,
        dstAddress: dto.dstAddress,
        amount:     dto.amount,
        token:      dto.token,
        nonce:      nonce.toString(),
        deadline:   new Date(deadline * 1000),
        status:     'PENDING',
      },
    });

    // Queue the actual lock transaction
    await this.bridgeQueue.add(
      'lock-tokens',
      { transferId: transfer.id, userId, walletAddress, ...dto, nonce, deadline },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    this.logger.log(`Bridge initiated: ${transfer.id}`);
    return transfer;
  }

  // ─── Called by validator after enough signatures collected ───────

  async executeMint(transferId: string, signatures: string[]) {
    const transfer = await this.prisma.bridgeTransfer.findUniqueOrFail({
      where: { id: transferId },
    });

    if (transfer.status !== 'SIGNATURES_COLLECTED') {
      throw new BadRequestException('Transfer not ready for mint');
    }

    const bridgeAddress = this.getBridgeAddress(transfer.dstChain);
    const provider      = this.getProvider(transfer.dstChain);
    const relayer       = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridge        = new ethers.Contract(bridgeAddress, BRIDGE_ABI, relayer);

    const tx = await bridge.mint(
      {
        from:       transfer.srcAddress,
        to:         transfer.dstAddress,
        amount:     ethers.parseUnits(transfer.amount, 6),
        srcChainId: this.chainIds[transfer.srcChain],
        dstChainId: this.chainIds[transfer.dstChain],
        nonce:      BigInt(transfer.nonce),
        deadline:   Math.floor(transfer.deadline.getTime() / 1000),
      },
      signatures,
    );

    await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id: transferId },
      data:  { status: 'COMPLETED', dstTxHash: tx.hash },
    });

    this.logger.log(`Bridge mint completed: ${tx.hash}`);
    return { txHash: tx.hash };
  }

  // ─── Query ───────────────────────────────────────────────────────

  async getTransfer(id: string) {
    return this.prisma.bridgeTransfer.findUniqueOrFail({
      where:   { id },
      include: { validatorSignatures: true },
    });
  }

  async getUserTransfers(userId: string) {
    return this.prisma.bridgeTransfer.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private getProvider(chain: string): ethers.JsonRpcProvider {
    const urls: Record<string, string> = {
      ethereum: process.env.ETH_RPC!,
      bsc:      process.env.BSC_RPC!,
      polygon:  process.env.POLYGON_RPC!,
    };
    return new ethers.JsonRpcProvider(urls[chain]);
  }

  private getBridgeAddress(chain: string): string {
    const addresses: Record<string, string> = {
      ethereum: process.env.ETH_BRIDGE_ADDRESS!,
      bsc:      process.env.BSC_BRIDGE_ADDRESS!,
      polygon:  process.env.POLYGON_BRIDGE_ADDRESS!,
    };
    return addresses[chain];
  }
}