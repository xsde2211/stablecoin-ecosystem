import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { TronWeb } from 'tronweb';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeService } from './bridge.service';
import { CHAIN_CONFIGS, getTokenId } from './chain.config';
import { BRIDGE_V2_ABI, ERC20_ABI } from './bridge.abi';

@Processor('bridge')
export class BridgeProcessor {
  private readonly logger = new Logger(BridgeProcessor.name);

  constructor(
    private prisma: PrismaService,
    private bridgeService: BridgeService,
  ) {}

  // ─── Lock tokens on source chain ──────────────────────────────

  @Process('lock-tokens')
  async handleLock(job: Job) {
    const { transferId, srcChain, dstChain, token, amount, dstAddress, nonce, deadline, srcWalletAddress } = job.data;
    this.logger.log(`Processing lock for transfer ${transferId}`);

    try {
      const config = CHAIN_CONFIGS[srcChain];

      if (srcChain === 'tron') {
        await this.lockOnTron(job.data);
      } else if (config?.isEvm) {
        await this.lockOnEVM(job.data);
      } else {
        throw new Error(`Unsupported source chain: ${srcChain}`);
      }

      await this.prisma.bridgeTransfer.update({
        where: { id: transferId },
        data:  { status: 'LOCKED' },
      });

      this.logger.log(`Lock successful for transfer ${transferId}`);
    } catch (err) {
      this.logger.error(`Lock failed for transfer ${transferId}:`, err);
      await this.prisma.bridgeTransfer.update({
        where: { id: transferId },
        data:  { status: 'FAILED' },
      });
      throw err; // Bull will retry
    }
  }

  // ─── Execute mint on destination chain ────────────────────────

  @Process('execute-mint')
  async handleExecuteMint(job: Job) {
    const { transferId } = job.data;
    this.logger.log(`Executing mint for transfer ${transferId}`);

    try {
      await this.bridgeService.executeMint(transferId);
    } catch (err) {
      this.logger.error(`Mint execution failed for ${transferId}:`, err);
      await this.prisma.bridgeTransfer.update({
        where: { id: transferId },
        data:  { status: 'FAILED' },
      });
      throw err;
    }
  }

  // ─── Burn tokens on destination chain ─────────────────────────

  @Process('burn-tokens')
  async handleBurn(job: Job) {
    const { transferId, dstChain, token, amount, srcChain, srcRecipient, nonce, deadline } = job.data;
    this.logger.log(`Processing burn for transfer ${transferId}`);

    try {
      const config = CHAIN_CONFIGS[dstChain];

      if (dstChain === 'tron') {
        await this.burnOnTron(job.data);
      } else if (config?.isEvm) {
        await this.burnOnEVM(job.data);
      } else {
        throw new Error(`Unsupported destination chain: ${dstChain}`);
      }

      await this.prisma.bridgeTransfer.update({
        where: { id: transferId },
        data:  { status: 'LOCKED' }, // Re-use LOCKED to indicate burn confirmed
      });

      this.logger.log(`Burn successful for transfer ${transferId}`);
    } catch (err) {
      this.logger.error(`Burn failed for transfer ${transferId}:`, err);
      await this.prisma.bridgeTransfer.update({
        where: { id: transferId },
        data:  { status: 'FAILED' },
      });
      throw err;
    }
  }

  // ─── EVM lock implementation ───────────────────────────────────

  private async lockOnEVM(data: any) {
    const config  = CHAIN_CONFIGS[data.srcChain];
    const rpcUrl  = process.env[config.rpcEnvKey];
    if (!rpcUrl) throw new Error(`Missing RPC for ${data.srcChain}`);

    const provider  = new ethers.JsonRpcProvider(rpcUrl);
    const relayer   = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridge    = new ethers.Contract(config.bridgeAddress, BRIDGE_V2_ABI, relayer);

    const dstConfig  = CHAIN_CONFIGS[data.dstChain];
    const tokenId    = getTokenId(data.token);
    const amountWei  = ethers.parseUnits(data.amount, 6);
    const dstChainId = dstConfig?.chainId ?? 0;

    // Approve bridge to spend tokens (if relayer-assisted)
    const tokenAddress = config.tokens[data.token];
    if (!tokenAddress) throw new Error(`Token ${data.token} not configured for ${data.srcChain}`);

    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, relayer);
    const allowance     = await tokenContract.allowance(relayer.address, config.bridgeAddress);
    if (allowance < amountWei) {
      const approveTx = await tokenContract.approve(config.bridgeAddress, amountWei);
      await approveTx.wait();
    }

    const tx = await bridge.lock(
      tokenId,
      amountWei,
      dstChainId,
      data.dstAddress,
      data.nonce,
      data.deadline,
    );
    const receipt = await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id: data.transferId },
      data:  { srcTxHash: receipt.hash },
    });

    this.logger.log(`EVM lock tx: ${receipt.hash}`);
  }

  // ─── Tron lock implementation ──────────────────────────────────

  private async lockOnTron(data: any) {
    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: process.env.RELAYER_TRON_PRIVATE_KEY!,
    });

    const bridge      = await tronWeb.contract().at(CHAIN_CONFIGS.tron.bridgeAddress);
    const amountMicro = BigInt(Math.round(parseFloat(data.amount) * 1_000_000)).toString();

    const txId = await bridge.lock(
      data.token,
      amountMicro,
      data.dstChain,
      data.dstAddress,
      data.nonce.toString(),
      data.deadline.toString(),
    ).send({ feeLimit: 200_000_000 });

    await this.prisma.bridgeTransfer.update({
      where: { id: data.transferId },
      data:  { srcTxHash: txId },
    });

    this.logger.log(`Tron lock txId: ${txId}`);
  }

  // ─── EVM burn implementation ───────────────────────────────────

  private async burnOnEVM(data: any) {
    const config  = CHAIN_CONFIGS[data.dstChain];
    const rpcUrl  = process.env[config.rpcEnvKey];
    if (!rpcUrl) throw new Error(`Missing RPC for ${data.dstChain}`);

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const relayer  = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridge   = new ethers.Contract(config.bridgeAddress, BRIDGE_V2_ABI, relayer);

    const srcConfig  = CHAIN_CONFIGS[data.srcChain];
    const tokenId    = getTokenId(data.token);
    const amountWei  = ethers.parseUnits(data.amount, 6);
    const srcChainId = srcConfig?.chainId ?? 0;

    const tx = await bridge.burn(
      tokenId,
      amountWei,
      srcChainId,
      data.srcRecipient,
      data.nonce,
      data.deadline,
    );
    const receipt = await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id: data.transferId },
      data:  { srcTxHash: receipt.hash },
    });

    this.logger.log(`EVM burn tx: ${receipt.hash}`);
  }

  // ─── Tron burn implementation ──────────────────────────────────

  private async burnOnTron(data: any) {
    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: process.env.RELAYER_TRON_PRIVATE_KEY!,
    });

    const bridge      = await tronWeb.contract().at(CHAIN_CONFIGS.tron.bridgeAddress);
    const amountMicro = BigInt(Math.round(parseFloat(data.amount) * 1_000_000)).toString();

    const txId = await bridge.burn(
      data.token,
      amountMicro,
      data.srcChain,
      data.srcRecipient,
      data.nonce.toString(),
      data.deadline.toString(),
    ).send({ feeLimit: 200_000_000 });

    await this.prisma.bridgeTransfer.update({
      where: { id: data.transferId },
      data:  { srcTxHash: txId },
    });

    this.logger.log(`Tron burn txId: ${txId}`);
  }
}
