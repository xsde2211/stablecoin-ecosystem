import {
  Injectable, BadRequestException,
  NotFoundException, Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue }       from 'bull';
import { ethers }      from 'ethers';
import { TronWeb }     from 'tronweb';
import { PrismaService }      from '../prisma/prisma.service';
import { RedisService }       from '../redis/redis.service';
import { InitiateBridgeDto }  from './dto/initiate-bridge.dto';
import { BurnBridgeDto }      from './dto/burn-bridge.dto';

// Updated BridgeV2 ABI — includes lock, burn, unlock, mint
const BRIDGE_V2_ABI = [
  // Lock: user → bridge on source chain
  'function lock(bytes32 tokenId, uint256 amount, uint256 dstChainId, address dstRecipient, uint256 nonce, uint256 deadline)',
  // Burn: user burns bridged tokens on destination to return
  'function burn(bytes32 tokenId, uint256 amount, uint256 srcChainId, address srcRecipient, uint256 nonce, uint256 deadline)',
  // Mint: relayer mints on destination after validators sign
  'function mintTokens(bytes32 tokenId, address recipient, uint256 amount, string srcChain, bytes32 srcNonce, bytes[] signatures)',
  // Unlock: relayer unlocks on source after burn on destination
  'function unlock(bytes32 tokenId, address recipient, uint256 amount, uint256 srcChainId, bytes32 nonceKey, bytes[] signatures)',
  'function paused() view returns (bool)',
  'event TokensLocked(bytes32 indexed tokenId, address indexed from, uint256 amount, uint256 dstChainId, address dstRecipient, uint256 nonce, uint256 deadline)',
  'event TokensMinted(bytes32 indexed tokenId, address indexed to, uint256 amount, uint256 srcChainId, bytes32 nonceKey)',
  'event TokensBurned(bytes32 indexed tokenId, address indexed from, uint256 amount, uint256 srcChainId, address srcRecipient, uint256 nonce, uint256 deadline)',
  'event TokensUnlocked(bytes32 indexed tokenId, address indexed to, uint256 amount, uint256 dstChainId, bytes32 nonceKey)',
];

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);

  // EVM chain IDs
  private readonly chainIds: Record<string, bigint> = {
    ethereum: 11155111n, // Sepolia testnet
    bsc:      97n,       // BSC testnet
    polygon:  80002n,    // Polygon Amoy testnet
    tron:     728126428n,
  };

  // Token IDs (keccak256 of token symbol — must match contract)
  private readonly tokenIds: Record<string, string> = {
    INRX:  ethers.keccak256(ethers.toUtf8Bytes('INRX')),
    EGOLD: ethers.keccak256(ethers.toUtf8Bytes('EGOLD')),
    ESLVR: ethers.keccak256(ethers.toUtf8Bytes('ESLVR')),
  };

  constructor(
    private prisma: PrismaService,
    private redis:  RedisService,
    @InjectQueue('bridge') private bridgeQueue: Queue,
  ) {}

  // ─── Initiate (LOCK flow: srcChain → dstChain) ─────────────────────────────

  async initiate(userId: string, dto: InitiateBridgeDto) {
    if (dto.srcChain === dto.dstChain) {
      throw new BadRequestException('Source and destination chains must differ');
    }

    // Get user wallet address for srcChain
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_chain: { userId, chain: dto.srcChain } },
    });
    if (!wallet) {
      throw new BadRequestException(`No wallet found for chain: ${dto.srcChain}. Create a wallet first.`);
    }

    const nonce    = Date.now();
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    const transfer = await this.prisma.bridgeTransfer.create({
      data: {
        userId,
        srcChain:   dto.srcChain,
        dstChain:   dto.dstChain,
        srcAddress: wallet.address,
        dstAddress: dto.dstAddress,
        amount:     dto.amount,
        token:      dto.token,
        nonce:      nonce.toString(),
        deadline:   new Date(deadline * 1000),
        status:     'PENDING',
      },
    });

    // Queue the lock transaction
    await this.bridgeQueue.add(
      'lock-tokens',
      {
        transferId:   transfer.id,
        userId,
        srcChain:     dto.srcChain,
        dstChain:     dto.dstChain,
        token:        dto.token,
        amount:       dto.amount,
        dstAddress:   dto.dstAddress,
        walletAddress:wallet.address,
        nonce,
        deadline,
      },
      { attempts:3, backoff:{ type:'exponential', delay:5000 } },
    );

    this.logger.log(`Bridge initiated: ${transfer.id} — ${dto.srcChain}→${dto.dstChain}`);
    return transfer;
  }

  // ─── Burn (BURN flow: user burns on dstChain to return to srcChain) ─────────

  async initiateBurn(userId: string, dto: BurnBridgeDto) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_chain: { userId, chain: dto.chain } },
    });
    if (!wallet) throw new BadRequestException(`No wallet for chain: ${dto.chain}`);

    const nonce    = Date.now();
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const transfer = await this.prisma.bridgeTransfer.create({
      data: {
        userId,
        srcChain:   dto.srcChain,
        dstChain:   dto.chain,
        srcAddress: dto.srcRecipient,
        dstAddress: wallet.address,
        amount:     dto.amount,
        token:      dto.token,
        nonce:      nonce.toString(),
        deadline:   new Date(deadline * 1000),
        status:     'PENDING',
        type:       'BURN_UNLOCK',
      },
    });

    await this.bridgeQueue.add(
      'burn-tokens',
      {
        transferId:   transfer.id,
        userId,
        chain:        dto.chain,
        srcChain:     dto.srcChain,
        token:        dto.token,
        amount:       dto.amount,
        srcRecipient: dto.srcRecipient,
        walletAddress:wallet.address,
        nonce,
        deadline,
      },
      { attempts:3, backoff:{ type:'exponential', delay:5000 } },
    );

    this.logger.log(`Burn initiated: ${transfer.id} — ${dto.chain}→${dto.srcChain}`);
    return transfer;
  }

  // ─── Get transfer ───────────────────────────────────────────────────────────

  async getTransfer(id: string, userId: string) {
    const transfer = await this.prisma.bridgeTransfer.findFirst({
      where:   { id, userId },
      include: { validatorSignatures: true },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }

  // ─── Get history ────────────────────────────────────────────────────────────

  async getUserTransfers(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.bridgeTransfer.findMany({
        where:   { userId },
        orderBy: { createdAt:'desc' },
        skip,
        take:    limit,
        include: { validatorSignatures: { select: { validatorAddr: true, signedAt: true } } },
      }),
      this.prisma.bridgeTransfer.count({ where:{ userId } }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total/limit) };
  }

  // ─── Relayer: execute mint (called by validator/relayer service) ─────────────

  async executeMint(transferId: string, signatures: string[]) {
    const transfer = await this.prisma.bridgeTransfer.findUnique({ where:{ id:transferId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'LOCKED') {
      throw new BadRequestException(`Transfer status is ${transfer.status}, expected LOCKED`);
    }

    const provider    = this.getProvider(transfer.dstChain);
    const relayer     = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridgeAddr  = this.getBridgeAddress(transfer.dstChain);
    const bridge      = new ethers.Contract(bridgeAddr, BRIDGE_V2_ABI, relayer);

    const tokenId  = this.tokenIds[transfer.token];
    const srcNonce = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256','uint256'],
        [this.chainIds[transfer.srcChain], BigInt(transfer.nonce)]
      )
    );

    const tx      = await bridge.mintTokens(
      tokenId, transfer.dstAddress,
      ethers.parseUnits(transfer.amount, 6),
      transfer.srcChain, srcNonce, signatures,
    );
    const receipt = await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id:transferId },
      data:  { status:'COMPLETED', dstTxHash:receipt.hash },
    });

    this.logger.log(`Mint executed: ${receipt.hash}`);
    return { txHash:receipt.hash, status:'COMPLETED' };
  }

  // ─── Relayer: execute unlock ──────────────────────────────────────────────

  async executeUnlock(transferId: string, signatures: string[]) {
    const transfer = await this.prisma.bridgeTransfer.findUnique({ where:{ id:transferId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'LOCKED') {
      throw new BadRequestException(`Transfer status is ${transfer.status}, expected LOCKED`);
    }

    const provider   = this.getProvider(transfer.srcChain);
    const relayer    = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridgeAddr = this.getBridgeAddress(transfer.srcChain);
    const bridge     = new ethers.Contract(bridgeAddr, BRIDGE_V2_ABI, relayer);

    const tokenId  = this.tokenIds[transfer.token];
    const srcNonce = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256','uint256'],
        [this.chainIds[transfer.dstChain], BigInt(transfer.nonce)]
      )
    );

    const tx = await bridge.unlock(
      tokenId, transfer.srcAddress,
      ethers.parseUnits(transfer.amount, 6),
      this.chainIds[transfer.dstChain],
      srcNonce, signatures,
    );
    const receipt = await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id:transferId },
      data:  { status:'COMPLETED', dstTxHash:receipt.hash },
    });

    return { txHash:receipt.hash, status:'COMPLETED' };
  }

  // ─── Get bridge status across chains ────────────────────────────────────────

  async getBridgeStatus() {
    const chains  = ['ethereum','polygon'];
    const results = [];
    for (const chain of chains) {
      try {
        const addr    = this.getBridgeAddress(chain);
        const provider= this.getProvider(chain);
        const bridge  = new ethers.Contract(addr, BRIDGE_V2_ABI, provider);
        const paused  = await bridge.paused();
        results.push({ chain, address:addr, paused, status: paused ? 'PAUSED':'ACTIVE' });
      } catch {
        results.push({ chain, status:'UNREACHABLE' });
      }
    }
    return results;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  getProvider(chain: string): ethers.JsonRpcProvider {
    const map: Record<string,string> = {
      ethereum: process.env.ETH_RPC!,
      bsc:      process.env.BSC_RPC!,
      polygon:  process.env.POLYGON_RPC!,
    };
    if (!map[chain]) throw new BadRequestException(`Unsupported EVM chain: ${chain}`);
    return new ethers.JsonRpcProvider(map[chain]);
  }

  getBridgeAddress(chain: string): string {
    const map: Record<string,string> = {
      ethereum: process.env.ETH_BRIDGE_V2_ADDRESS   || process.env.ETH_BRIDGE_V2_ADDRESS!,
      bsc:      process.env.BSC_BRIDGE_V2_ADDRESS!,
      polygon:  process.env.POLYGON_BRIDGE_V2_ADDRESS || process.env.POLYGON_BRIDGE_V2_ADDRESS!,
    };
    if (!map[chain]) throw new BadRequestException(`Bridge not configured for chain: ${chain}`);
    return map[chain];
  }

  getTokenId(symbol: string): string {
    const id = this.tokenIds[symbol];
    if (!id) throw new BadRequestException(`Unknown token: ${symbol}`);
    return id;
  }

  getChainId(chain: string): bigint {
    const id = this.chainIds[chain];
    if (!id) throw new BadRequestException(`Unknown chain: ${chain}`);
    return id;
  }
}
