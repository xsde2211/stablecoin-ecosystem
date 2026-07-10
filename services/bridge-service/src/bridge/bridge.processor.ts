import { Processor, Process } from '@nestjs/bull';
import { Logger }             from '@nestjs/common';
import { Job }                from 'bull';
import { ethers }             from 'ethers';
import { TronWeb }            from 'tronweb';
import { derivePrivateKey }   from '@ecosystem/crypto';
import { PrismaService }      from '../prisma/prisma.service';
import { BridgeService }      from './bridge.service';
import { KmsService }         from './kms.service';

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
    private kms:      KmsService,
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

      // MODE=TESTING only: auto-complete the flow right here (sign with the
      // validator keys in .env, execute mint with the relayer key in .env).
      // In production this is the validator dashboard's job — a real human
      // validator reviews the lock and signs it, and only once enough real
      // signatures are collected does something call executeMint/
      // executeTronMint. So in production we deliberately stop here and
      // leave the transfer LOCKED for that (separate, in-progress) system
      // to pick up.
      if (this.bridgeSvc.isTestingMode()) {
        try {
          if (dstChain === 'tron') {
            await this.bridgeSvc.executeTronMint(transferId);
          } else {
            await this.bridgeSvc.executeMint(transferId);
          }
          this.logger.log(`[TESTING] Mint auto-completed for transfer ${transferId}`);
        } catch (mintErr: any) {
          this.logger.error(`[TESTING] Mint failed for ${transferId}: ${mintErr.message}`);
          await this.prisma.bridgeTransfer.update({
            where: { id:transferId },
            data:  { status:'FAILED' },
          });
        }
      } else {
        this.logger.log(`Transfer ${transferId} is LOCKED — waiting for the validator dashboard (MODE=PRODUCTION)`);
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

      // Same MODE split as handleLock above.
      if (this.bridgeSvc.isTestingMode()) {
        try {
          if (srcChain === 'tron') {
            await this.bridgeSvc.executeTronUnlock(transferId);
          } else {
            await this.bridgeSvc.executeUnlock(transferId);
          }
          this.logger.log(`[TESTING] Unlock auto-completed for transfer ${transferId}`);
        } catch (unlockErr: any) {
          this.logger.error(`[TESTING] Unlock failed for ${transferId}: ${unlockErr.message}`);
          await this.prisma.bridgeTransfer.update({
            where: { id:transferId },
            data:  { status:'FAILED' },
          });
        }
      } else {
        this.logger.log(`Transfer ${transferId} is LOCKED — waiting for the validator dashboard (MODE=PRODUCTION)`);
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

  // ─── Get the ACTUAL USER's signing key for a lock/burn ─────────────────────
  //
  // THE FIX: lock()/burn() were previously signed with RELAYER_PRIVATE_KEY,
  // which means msg.sender inside the contract was the RELAYER's address —
  // so the contract's `transferFrom(msg.sender, ...)` tried to pull tokens
  // out of the RELAYER's own balance, not the user's. That's exactly the
  // "ERC20: transfer amount exceeds balance" error: the relayer wallet
  // never held the user's tokens in the first place.
  //
  // Locking/burning moves the USER's own balance, so it must be signed by
  // the USER's own wallet (decrypted the same way wallet-service already
  // does it for sendToken()) — the relayer's key is only for gas-paying the
  // LATER mint/unlock execution step, which is a completely separate
  // transaction on a different chain, using different tokens. This matches
  // your own description: "relayer... carries validator signatures... and
  // pays gas for executing the bridge transaction" (i.e. mint/unlock only).
  //
  // NOTE: since the user's own wallet now pays for and signs this
  // transaction, that wallet needs its own native gas balance (ETH/BNB/MATIC
  // for EVM chains, TRX for Tron) — same requirement wallet-service's
  // sendToken() already has for regular transfers.

  private async getUserMnemonic(userId: string, chain: string, address: string): Promise<string> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain, address, isActive: true },
    });
    if (!wallet) {
      throw new Error(`No active wallet found for user ${userId} on ${chain} (${address}) — cannot sign lock/burn`);
    }
    return this.kms.decrypt(wallet.encPrivateKey);
  }

  private async getUserEvmSigner(userId: string, chain: string, address: string, provider: ethers.JsonRpcProvider): Promise<ethers.Wallet> {
    const mnemonic   = await this.getUserMnemonic(userId, chain, address);
    const privateKey = derivePrivateKey(mnemonic, chain as 'ethereum' | 'bsc' | 'polygon');
    return new ethers.Wallet(privateKey, provider);
  }

  private async getUserTronPrivateKey(userId: string, address: string): Promise<string> {
    const mnemonic   = await this.getUserMnemonic(userId, 'tron', address);
    const privateKey = derivePrivateKey(mnemonic, 'tron');
    return privateKey.slice(2); // TronWeb wants the hex WITHOUT the 0x prefix
  }

  // ─── EVM lock ─────────────────────────────────────────────────────────────

  private async lockOnEVM(data: any): Promise<string> {
    const provider   = this.bridgeSvc.getProvider(data.srcChain);
    const userSigner = await this.getUserEvmSigner(data.userId, data.srcChain, data.walletAddress, provider);
    const bridgeAddr = this.bridgeSvc.getBridgeAddress(data.srcChain);

    // Approve bridge to spend tokens first — must be the USER approving,
    // since it's their tokens the bridge will pull via transferFrom().
    const tokenAddr = this.getTokenAddress(data.srcChain, data.token);
    const tokenCont = new ethers.Contract(tokenAddr, ERC20_ABI, userSigner);
    const amount    = ethers.parseUnits(data.amount, 6);

    const allowance = await tokenCont.allowance(userSigner.address, bridgeAddr);
    if (allowance < amount) {
      const approveTx = await tokenCont.approve(bridgeAddr, ethers.MaxUint256);
      await approveTx.wait();
    }

    const BRIDGE_ABI = [
      'function lock(bytes32 tokenId, uint256 amount, uint256 dstChainId, address dstRecipient, uint256 nonce, uint256 deadline)',
    ];
    const bridge  = new ethers.Contract(bridgeAddr, BRIDGE_ABI, userSigner);
    const tokenId = this.bridgeSvc.getTokenId(data.token);
    const chainId = this.bridgeSvc.getChainId(data.dstChain);

    // data.dstAddress is on data.dstChain, which can be 'tron' (a base58
    // string, not valid hex). normalizeAddressForChain converts it to its
    // raw 20-byte hex form when the destination is tron; otherwise no-op.
    const dstRecipient = this.bridgeSvc.normalizeAddressForChain(data.dstAddress, data.dstChain);

    const tx      = await bridge.lock(tokenId, amount, chainId, dstRecipient, data.nonce, data.deadline);
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
    // Same fix as lockOnEVM: sign with the user's own wallet on the burn
    // chain, not the relayer — it's the user's own bridged tokens being burned.
    const userSigner = await this.getUserEvmSigner(data.userId, data.chain, data.walletAddress, provider);
    const bridgeAddr = this.bridgeSvc.getBridgeAddress(data.chain);

    const BRIDGE_ABI = [
      'function burn(bytes32 tokenId, uint256 amount, uint256 srcChainId, address srcRecipient, uint256 nonce, uint256 deadline)',
    ];
    const bridge   = new ethers.Contract(bridgeAddr, BRIDGE_ABI, userSigner);
    const tokenId  = this.bridgeSvc.getTokenId(data.token);
    const chainId  = this.bridgeSvc.getChainId(data.srcChain);
    const amount   = ethers.parseUnits(data.amount, 6);

    // data.srcRecipient is on data.srcChain (the ORIGINAL chain being
    // unlocked to), which can be tron.
    const srcRecipient = this.bridgeSvc.normalizeAddressForChain(data.srcRecipient, data.srcChain);

    const tx      = await bridge.burn(tokenId, amount, chainId, srcRecipient, data.nonce, data.deadline);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ─── TRON lock ────────────────────────────────────────────────────────────

  private async lockOnTron(data: any): Promise<string> {
    const userTronKey = await this.getUserTronPrivateKey(data.userId, data.walletAddress);
    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: userTronKey, // user's own key — same fix as the EVM side
    });
    const bridge       = await tronWeb.contract().at(process.env.TRON_BRIDGE_V2_ADDRESS!);
    const amountMicro  = BigInt(Math.round(parseFloat(data.amount) * 1_000_000)).toString();

    const txId = await bridge.lock(
      data.token, amountMicro,
      data.dstChain, data.dstAddress,
      data.nonce.toString(), data.deadline.toString(),
    ).send({ feeLimit:200_000_000 });

    // Same fix as executeTronMint/executeTronUnlock: .send() only confirms
    // the tx was broadcast, not that it succeeded — verify before reporting
    // this lock as done.
    await this.bridgeSvc.verifyTronTx(tronWeb, txId);

    return txId;
  }

  // ─── TRON burn ────────────────────────────────────────────────────────────

  private async burnOnTron(data: any): Promise<string> {
    const userTronKey = await this.getUserTronPrivateKey(data.userId, data.walletAddress);
    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: userTronKey,
    });
    const bridge      = await tronWeb.contract().at(process.env.TRON_BRIDGE_V2_ADDRESS!);
    const amountMicro = BigInt(Math.round(parseFloat(data.amount) * 1_000_000)).toString();

    const txId = await bridge.burn(
      data.token, amountMicro,
      data.srcChain, data.srcRecipient,
      data.nonce.toString(), data.deadline.toString(),
    ).send({ feeLimit:200_000_000 });

    await this.bridgeSvc.verifyTronTx(tronWeb, txId);

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