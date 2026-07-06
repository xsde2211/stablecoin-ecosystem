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

// Updated BridgeV2 ABI — matches the REAL deployed StablecoinBridgeV2.sol.
// mint()/unlock() take a BridgeRequest struct + validator signatures verified
// on-chain via ECDSA.recover() — there is no mintTokens() function; the
// previous ABI here didn't match the contract at all.
const BRIDGE_V2_ABI = [
  // Lock: user → bridge on source chain
  'function lock(bytes32 tokenId, uint256 amount, uint256 dstChainId, address dstRecipient, uint256 nonce, uint256 deadline)',
  // Burn: user burns bridged tokens on destination to return
  'function burn(bytes32 tokenId, uint256 amount, uint256 srcChainId, address srcRecipient, uint256 nonce, uint256 deadline)',
  // Mint: relayer calls after collecting >= requiredValidators signatures over the request hash
  'function mint(tuple(bytes32 tokenId, address from, address to, uint256 amount, uint256 srcChainId, uint256 dstChainId, uint256 nonce, uint256 deadline) req, bytes[] sigs)',
  // Unlock: relayer calls on the ORIGINAL chain after a burn on the destination chain
  'function unlock(tuple(bytes32 tokenId, address from, address to, uint256 amount, uint256 srcChainId, uint256 dstChainId, uint256 nonce, uint256 deadline) req, bytes[] sigs)',
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
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain: dto.srcChain, walletIndex: 0 },
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
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain: dto.chain, walletIndex: 0 },
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

  // ─── Signing — matches contract's _hashRequest() + ECDSA.toEthSignedMessageHash exactly ───
  //
  // Contract: bytes32 msgHash = ECDSA.toEthSignedMessageHash(_hashRequest(req));
  //           _hashRequest = keccak256(abi.encode(tokenId, from, to, amount, srcChainId, dstChainId, nonce, deadline))
  // ethers' wallet.signMessage() applies the identical "\x19Ethereum Signed Message:\n32"
  // prefix that toEthSignedMessageHash does, so signing the raw inner hash here
  // reproduces exactly what hash.recover(sig) expects on-chain.

  private buildBridgeRequest(params: {
    token: string; from: string; to: string; amount: string;
    srcChain: string; dstChain: string; nonce: string; deadline: Date;
  }) {
    return {
      tokenId:    this.tokenIds[params.token],
      from:       params.from,
      to:         params.to,
      amount:     ethers.parseUnits(params.amount, 6),
      srcChainId: this.chainIds[params.srcChain],
      dstChainId: this.chainIds[params.dstChain],
      nonce:      BigInt(params.nonce),
      deadline:   BigInt(Math.floor(params.deadline.getTime() / 1000)),
    };
  }

  private async signBridgeRequest(req: ReturnType<BridgeService['buildBridgeRequest']>): Promise<string[]> {
    const innerHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
        [req.tokenId, req.from, req.to, req.amount, req.srcChainId, req.dstChainId, req.nonce, req.deadline],
      ),
    );

    // REQUIRED_VALIDATORS=2 on the deployed contracts — use the first 2 of the
    // 3 configured validator keys. All 3 are independently valid signers on-chain;
    // any 2-of-3 combination satisfies the threshold.
    const validatorKeys = [process.env.VALIDATOR_1_PRIVATE_KEY, process.env.VALIDATOR_2_PRIVATE_KEY]
      .filter((k): k is string => !!k);

    if (validatorKeys.length < 2) {
      throw new Error('Need at least 2 validator private keys configured (VALIDATOR_1_PRIVATE_KEY, VALIDATOR_2_PRIVATE_KEY)');
    }

    return Promise.all(
      validatorKeys.map((key) => new ethers.Wallet(key).signMessage(ethers.getBytes(innerHash))),
    );
  }

  // ─── Relayer: execute mint (called automatically once a lock is confirmed) ───

  async executeMint(transferId: string) {
    const transfer = await this.prisma.bridgeTransfer.findUnique({ where:{ id:transferId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'LOCKED') {
      throw new BadRequestException(`Transfer status is ${transfer.status}, expected LOCKED`);
    }

    const provider    = this.getProvider(transfer.dstChain); // mint executes on the destination chain
    const relayer     = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridgeAddr  = this.getBridgeAddress(transfer.dstChain);
    const bridge      = new ethers.Contract(bridgeAddr, BRIDGE_V2_ABI, relayer);

    const req = this.buildBridgeRequest({
      token: transfer.token, from: transfer.srcAddress, to: transfer.dstAddress,
      amount: transfer.amount, srcChain: transfer.srcChain, dstChain: transfer.dstChain,
      nonce: transfer.nonce, deadline: transfer.deadline,
    });
    const sigs = await this.signBridgeRequest(req);

    const tx      = await bridge.mint(req, sigs);
    const receipt = await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id:transferId },
      data:  { status:'COMPLETED', dstTxHash:receipt.hash },
    });

    this.logger.log(`Mint executed: ${receipt.hash}`);
    return { txHash:receipt.hash, status:'COMPLETED' };
  }

  // ─── Relayer: execute unlock (called automatically once a burn is confirmed) ──

  async executeUnlock(transferId: string) {
    const transfer = await this.prisma.bridgeTransfer.findUnique({ where:{ id:transferId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'LOCKED') {
      throw new BadRequestException(`Transfer status is ${transfer.status}, expected LOCKED`);
    }

    // Unlock releases the ORIGINALLY locked tokens, so it executes on transfer.srcChain
    // (in our BURN_UNLOCK convention, srcChain = the original chain, dstChain = the burn chain).
    // The contract itself requires req.srcChainId === its own configured chainId.
    const provider   = this.getProvider(transfer.srcChain);
    const relayer    = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridgeAddr = this.getBridgeAddress(transfer.srcChain);
    const bridge     = new ethers.Contract(bridgeAddr, BRIDGE_V2_ABI, relayer);

    const req = this.buildBridgeRequest({
      token: transfer.token,
      from: transfer.dstAddress,   // the burner's address, on the burn chain
      to: transfer.srcAddress,     // recipient of the unlocked funds, on the original chain
      amount: transfer.amount,
      srcChain: transfer.srcChain, // must equal the chain we're executing on
      dstChain: transfer.dstChain, // the burn chain
      nonce: transfer.nonce, deadline: transfer.deadline,
    });
    const sigs = await this.signBridgeRequest(req);

    const tx      = await bridge.unlock(req, sigs);
    const receipt = await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id:transferId },
      data:  { status:'COMPLETED', dstTxHash:receipt.hash },
    });

    this.logger.log(`Unlock executed: ${receipt.hash}`);
    return { txHash:receipt.hash, status:'COMPLETED' };
  }

  // ─── TRON completion ──────────────────────────────────────────────────────
  //
  // TronBridge.sol has a different interface than StablecoinBridgeV2.sol:
  // string token symbols instead of bytes32 tokenIds, and a single opaque
  // bytes32 srcNonce (that WE choose) instead of a struct the contract hashes
  // itself. The message hash is keccak256(abi.encodePacked(token, recipient,
  // amount, srcChain, srcNonce)) — matched exactly below via solidityPackedKeccak256.

  private toTronEvmAddress(base58Address: string): string {
    // TRON addresses are Ethereum-style 20-byte addresses wrapped in base58check
    // with a leading 0x41 prefix. Solidity's `address` type only ever sees the
    // raw 20 bytes, so the off-chain hash must use that form too — using the
    // base58 string directly here would make the recovered signer never match
    // an actual validator, and every mint/unlock would revert.
    const hex41 = TronWeb.address.toHex(base58Address); // "41" + 40 hex chars
    return '0x' + hex41.slice(2);
  }

  private async signTronRequest(
    token: string, recipientBase58: string, amount: bigint, srcChain: string, srcNonce: string,
  ): Promise<string[]> {
    const recipientEvmStyle = this.toTronEvmAddress(recipientBase58);
    const msgHash = ethers.solidityPackedKeccak256(
      ['string', 'address', 'uint256', 'string', 'bytes32'],
      [token, recipientEvmStyle, amount, srcChain, srcNonce],
    );

    const validatorKeys = [process.env.VALIDATOR_1_PRIVATE_KEY, process.env.VALIDATOR_2_PRIVATE_KEY]
      .filter((k): k is string => !!k);
    if (validatorKeys.length < 2) {
      throw new Error('Need at least 2 validator private keys configured');
    }
    return Promise.all(
      validatorKeys.map((key) => new ethers.Wallet(key).signMessage(ethers.getBytes(msgHash))),
    );
  }

  private getTronBridge() {
    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: process.env.RELAYER_TRON_PRIVATE_KEY!,
    });
    return tronWeb.contract().at(process.env.TRON_BRIDGE_V2_ADDRESS!);
  }

  async executeTronMint(transferId: string) {
    const transfer = await this.prisma.bridgeTransfer.findUnique({ where:{ id:transferId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'LOCKED') {
      throw new BadRequestException(`Transfer status is ${transfer.status}, expected LOCKED`);
    }

    const amount   = ethers.parseUnits(transfer.amount, 6);
    const srcNonce = ethers.keccak256(
      ethers.solidityPacked(['string', 'uint256'], [transfer.srcChain, BigInt(transfer.nonce)]),
    );
    const sigs = await this.signTronRequest(transfer.token, transfer.dstAddress, amount, transfer.srcChain, srcNonce);

    const bridge = await this.getTronBridge();
    const txId = await bridge.mintTokens(
      transfer.token, transfer.dstAddress, amount.toString(), transfer.srcChain, srcNonce, sigs,
    ).send({ feeLimit: 200_000_000 });

    await this.prisma.bridgeTransfer.update({
      where: { id:transferId },
      data:  { status:'COMPLETED', dstTxHash: txId },
    });

    this.logger.log(`TRON mint executed: ${txId}`);
    return { txHash: txId, status:'COMPLETED' };
  }

  async executeTronUnlock(transferId: string) {
    const transfer = await this.prisma.bridgeTransfer.findUnique({ where:{ id:transferId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'LOCKED') {
      throw new BadRequestException(`Transfer status is ${transfer.status}, expected LOCKED`);
    }

    const amount = ethers.parseUnits(transfer.amount, 6);
    // "srcChain" plays the same role here as in TronBridge's mint() — the
    // other chain involved in the operation. For unlock that's the chain the
    // corresponding burn happened on (our DB's dstChain in BURN_UNLOCK rows).
    const srcNonce = ethers.keccak256(
      ethers.solidityPacked(['string', 'uint256'], [transfer.dstChain, BigInt(transfer.nonce)]),
    );
    const sigs = await this.signTronRequest(transfer.token, transfer.srcAddress, amount, transfer.dstChain, srcNonce);

    const bridge = await this.getTronBridge();
    const txId = await bridge.unlock(
      transfer.token, transfer.srcAddress, amount.toString(), transfer.dstChain, srcNonce, sigs,
    ).send({ feeLimit: 200_000_000 });

    await this.prisma.bridgeTransfer.update({
      where: { id:transferId },
      data:  { status:'COMPLETED', dstTxHash: txId },
    });

    this.logger.log(`TRON unlock executed: ${txId}`);
    return { txHash: txId, status:'COMPLETED' };
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
      ethereum: process.env.ETH_BRIDGE_V2_ADDRESS!,
      bsc:      process.env.BSC_BRIDGE_V2_ADDRESS!,
      polygon:  process.env.POLYGON_BRIDGE_V2_ADDRESS!,
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