import { Processor, Process } from '@nestjs/bull';
import { Logger }             from '@nestjs/common';
import { Job }                from 'bull';
import { ethers }             from 'ethers';
import { TronWeb }            from 'tronweb';
import { PrismaService }      from '../prisma/prisma.service';
import { BridgeService }      from './bridge.service';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

@Processor('bridge')
export class BridgeProcessor {
  private readonly logger = new Logger(BridgeProcessor.name);

  constructor(
    private prisma:   PrismaService,
    private bridgeSvc:BridgeService,
  ) {}

  // ─── Lock tokens on source chain ──────────────────────────────────────────

  @Process('lock-tokens')
  async handleLock(job: Job) {
    const { transferId, srcChain, dstChain, token, amount, dstAddress, walletAddress, nonce, deadline } = job.data;
    this.logger.log(`Processing lock: ${transferId} on ${srcChain} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`);

    try {
      let srcTxHash: string;

      if (srcChain === 'tron') {
        srcTxHash = await this.lockOnTron(job.data);
      } else {
        srcTxHash = await this.lockOnEVM(job.data);
      }

      await this.prisma.bridgeTransfer.update({
        where: { id:transferId },
        data:  { status:'LOCKED', srcTxHash },
      });
      this.logger.log(`Lock successful: ${srcTxHash} for transfer ${transferId}`);

      // Auto-complete the flow: mint on the destination chain now that the
      // lock is confirmed. Kept as its own step/try-catch so a mint-side
      // failure (e.g. genuinely rejected by validator signature checks)
      // doesn't get confused with a lock-side failure in the logs or status.
      try {
        if (dstChain === 'tron') {
          await this.bridgeSvc.executeTronMint(transferId);
        } else {
          await this.bridgeSvc.executeMint(transferId);
        }
        this.logger.log(`Mint auto-completed for transfer ${transferId}`);
      } catch (mintErr: any) {
        this.logger.error(`Mint failed for ${transferId}: ${mintErr.message}`);
        await this.prisma.bridgeTransfer.update({
          where: { id:transferId },
          data:  { status:'FAILED' },
        });
      }
    } catch (err: any) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.error(`Lock failed for ${transferId} (attempt ${job.attemptsMade + 1}): ${err.message}`);

      if (isFinalAttempt) {
        // Only mark FAILED once every retry has genuinely been exhausted —
        // marking it on the first attempt was wrong, since Bull was still
        // going to retry 2 more times regardless, and the transfer should
        // stay PENDING (not flip to FAILED) while those retries are in flight.
        await this.prisma.bridgeTransfer.update({
          where: { id:transferId },
          data:  { status:'FAILED' },
        });
      }
      throw err; // Bull retries unless this was the final attempt
    }
  }

  // ─── Burn tokens on destination chain (return flow) ───────────────────────

  @Process('burn-tokens')
  async handleBurn(job: Job) {
    const { transferId, chain, token, amount, srcChain, srcRecipient, walletAddress, nonce, deadline } = job.data;
    this.logger.log(`Processing burn: ${transferId} on ${chain} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`);

    try {
      let burnTxHash: string;

      if (chain === 'tron') {
        burnTxHash = await this.burnOnTron(job.data);
      } else {
        burnTxHash = await this.burnOnEVM(job.data);
      }

      await this.prisma.bridgeTransfer.update({
        where: { id:transferId },
        data:  { status:'LOCKED', srcTxHash:burnTxHash },
      });
      this.logger.log(`Burn successful: ${burnTxHash} for transfer ${transferId}`);

      // Auto-complete the flow: unlock on the original chain now that the
      // burn is confirmed.
      try {
        if (srcChain === 'tron') {
          await this.bridgeSvc.executeTronUnlock(transferId);
        } else {
          await this.bridgeSvc.executeUnlock(transferId);
        }
        this.logger.log(`Unlock auto-completed for transfer ${transferId}`);
      } catch (unlockErr: any) {
        this.logger.error(`Unlock failed for ${transferId}: ${unlockErr.message}`);
        await this.prisma.bridgeTransfer.update({
          where: { id:transferId },
          data:  { status:'FAILED' },
        });
      }
    } catch (err: any) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.error(`Burn failed for ${transferId} (attempt ${job.attemptsMade + 1}): ${err.message}`);

      if (isFinalAttempt) {
        await this.prisma.bridgeTransfer.update({
          where: { id:transferId },
          data:  { status:'FAILED' },
        });
      }
      throw err;
    }
  }

  // ─── EVM lock ─────────────────────────────────────────────────────────────

  private async lockOnEVM(data: any): Promise<string> {
    const provider    = this.bridgeSvc.getProvider(data.srcChain);
    const relayer     = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridgeAddr  = this.bridgeSvc.getBridgeAddress(data.srcChain);

    // Approve bridge to spend tokens first
    const tokenAddr = this.getTokenAddress(data.srcChain, data.token);
    const tokenCont = new ethers.Contract(tokenAddr, ERC20_ABI, relayer);
    const amount    = ethers.parseUnits(data.amount, 6);

    const allowance = await tokenCont.allowance(relayer.address, bridgeAddr);
    if (allowance < amount) {
      const approveTx = await tokenCont.approve(bridgeAddr, ethers.MaxUint256);
      await approveTx.wait();
    }

    const BRIDGE_ABI = [
      'function lock(bytes32 tokenId, uint256 amount, uint256 dstChainId, address dstRecipient, uint256 nonce, uint256 deadline)',
    ];
    const bridge  = new ethers.Contract(bridgeAddr, BRIDGE_ABI, relayer);
    const tokenId = this.bridgeSvc.getTokenId(data.token);
    const chainId = this.bridgeSvc.getChainId(data.dstChain);

    const tx      = await bridge.lock(tokenId, amount, chainId, data.dstAddress, data.nonce, data.deadline);
    const receipt = await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id:data.transferId },
      data:  { srcTxHash:receipt.hash },
    });

    return receipt.hash;
  }

  // ─── EVM burn ─────────────────────────────────────────────────────────────

  private async burnOnEVM(data: any): Promise<string> {
    const provider   = this.bridgeSvc.getProvider(data.chain);
    const relayer    = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridgeAddr = this.bridgeSvc.getBridgeAddress(data.chain);

    const BRIDGE_ABI = [
      'function burn(bytes32 tokenId, uint256 amount, uint256 srcChainId, address srcRecipient, uint256 nonce, uint256 deadline)',
    ];
    const bridge   = new ethers.Contract(bridgeAddr, BRIDGE_ABI, relayer);
    const tokenId  = this.bridgeSvc.getTokenId(data.token);
    const chainId  = this.bridgeSvc.getChainId(data.srcChain);
    const amount   = ethers.parseUnits(data.amount, 6);

    const tx      = await bridge.burn(tokenId, amount, chainId, data.srcRecipient, data.nonce, data.deadline);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── TRON lock ────────────────────────────────────────────────────────────

  private async lockOnTron(data: any): Promise<string> {
    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: process.env.RELAYER_TRON_PRIVATE_KEY!,
    });
    const bridge       = await tronWeb.contract().at(process.env.TRON_BRIDGE_V2_ADDRESS!);
    const amountMicro  = BigInt(Math.round(parseFloat(data.amount) * 1_000_000)).toString();

    const txId = await bridge.lock(
      data.token, amountMicro,
      data.dstChain, data.dstAddress,
      data.nonce.toString(), data.deadline.toString(),
    ).send({ feeLimit:200_000_000 });

    return txId;
  }

  // ─── TRON burn ────────────────────────────────────────────────────────────

  private async burnOnTron(data: any): Promise<string> {
    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: process.env.RELAYER_TRON_PRIVATE_KEY!,
    });
    const bridge      = await tronWeb.contract().at(process.env.TRON_BRIDGE_V2_ADDRESS!);
    const amountMicro = BigInt(Math.round(parseFloat(data.amount) * 1_000_000)).toString();

    const txId = await bridge.burn(
      data.token, amountMicro,
      data.srcChain, data.srcRecipient,
      data.nonce.toString(), data.deadline.toString(),
    ).send({ feeLimit:200_000_000 });

    return txId;
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  private getTokenAddress(chain: string, symbol: string): string {
    const key = `${chain.toUpperCase()}_${symbol}_ADDRESS`;
    const val = process.env[key];
    if (!val) throw new Error(`Token address not configured: ${key}`);
    return val;
  }
}