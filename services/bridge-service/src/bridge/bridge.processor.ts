import { Processor, Process } from '@nestjs/bull';
import { Job }   from 'bull';
import { Logger } from '@nestjs/common';
import { ethers }  from 'ethers';
import { TronWeb } from 'tronweb';
import { PrismaService } from '../prisma/prisma.service';

@Processor('bridge')
export class BridgeProcessor {
  private readonly logger = new Logger(BridgeProcessor.name);

  constructor(private prisma: PrismaService) {}

  @Process('lock-tokens')
  async handleLock(job: Job) {
    const { transferId, srcChain, amount, token, nonce, deadline, walletAddress } = job.data;

    this.logger.log(`Processing lock for transfer ${transferId}`);

    try {
      if (srcChain === 'tron') {
        await this.lockOnTron(job.data);
      } else {
        await this.lockOnEVM(job.data);
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

  private async lockOnEVM(data: any) {
    const rpcUrls: Record<string, string> = {
      ethereum: process.env.ETH_RPC!,
      bsc:      process.env.BSC_RPC!,
      polygon:  process.env.POLYGON_RPC!,
    };
    const bridgeAddresses: Record<string, string> = {
      ethereum: process.env.ETH_BRIDGE_ADDRESS!,
      bsc:      process.env.BSC_BRIDGE_ADDRESS!,
      polygon:  process.env.POLYGON_BRIDGE_ADDRESS!,
    };

    const provider = new ethers.JsonRpcProvider(rpcUrls[data.srcChain]);
    const relayer  = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);
    const bridge   = new ethers.Contract(
      bridgeAddresses[data.srcChain],
      ['function lock(uint256,uint256,uint256,uint256)'],
      relayer,
    );

    const chainIds: Record<string, number> = {
      ethereum: 1, bsc: 56, polygon: 137, tron: 728126428,
    };

    const tx = await bridge.lock(
      ethers.parseUnits(data.amount, 6),
      chainIds[data.dstChain],
      data.nonce,
      data.deadline,
    );
    await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id: data.transferId },
      data:  { srcTxHash: tx.hash },
    });
  }

  private async lockOnTron(data: any) {
    const tronWeb  = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: process.env.RELAYER_TRON_PRIVATE_KEY!,
    });
    const bridge   = await tronWeb.contract().at(process.env.TRON_BRIDGE_ADDRESS!);
    const amountMicro = BigInt(parseFloat(data.amount) * 1_000_000).toString();

    const txId = await bridge.lock(
      data.token, amountMicro,
      data.dstChain, data.dstAddress,
      data.nonce.toString(), data.deadline.toString(),
    ).send({ feeLimit: 200_000_000 });

    await this.prisma.bridgeTransfer.update({
      where: { id: data.transferId },
      data:  { srcTxHash: txId },
    });
  }
}