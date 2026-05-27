import { ethers }  from 'ethers';
import { TronWeb } from 'tronweb';
import * as fs      from 'fs';
import * as dotenv  from 'dotenv';
dotenv.config();

// ─── Types ────────────────────────────────────────────────────────────────────

interface LockEvent {
  transferId:  string;   // our DB id
  sender:      string;
  token:       string;
  amount:      bigint;
  srcChain:    string;
  dstChain:    string;
  dstAddress:  string;
  nonce:       bigint;
  deadline:    number;
}

interface SignedAttestation {
  transferId:      string;
  validatorAddress: string;
  signature:       string;
  signedAt:        string;
}

// ─── Validator Service ────────────────────────────────────────────────────────

export class ValidatorService {
  private evmWallet:  ethers.Wallet;
  private tronWeb:    TronWeb;

  // How many validators must sign before relayer submits the mint tx
  public readonly requiredCount: number;

  // Chain ID map
  private readonly chainIds: Record<string, number> = {
    ethereum: 1,
    bsc:      56,
    polygon:  137,
    tron:     728126428,
    sepolia:  11155111,
  };

  constructor() {
    this.requiredCount = parseInt(process.env.REQUIRED_VALIDATORS ?? '2');

    // EVM signing wallet (this validator's private key)
    this.evmWallet = new ethers.Wallet(process.env.VALIDATOR_PRIVATE_KEY!);

    // TRON signing
    this.tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: process.env.VALIDATOR_TRON_PRIVATE_KEY!,
    });

    console.log('[Validator] EVM address:', this.evmWallet.address);
    console.log('[Validator] TRON address:', this.tronWeb.defaultAddress.base58);
  }

  // ─── Core: sign a cross-chain mint request ───────────────────────────────

  /**
   * Called by the bridge service after it detects a Lock event.
   * We verify the lock happened on-chain, then sign the mint request.
   */
  async signMintRequest(event: LockEvent): Promise<SignedAttestation> {
    // 1. Verify the lock transaction actually exists on source chain
    await this.verifyLockOnChain(event);

    // 2. Build the message that will be submitted to the destination bridge contract
    const messageHash = this.buildMessageHash(event);

    // 3. Sign with appropriate key depending on destination chain
    let signature: string;
    if (event.dstChain === 'tron') {
      signature = await this.signForTron(messageHash);
    } else {
      signature = await this.signForEVM(messageHash);
    }

    const attestation: SignedAttestation = {
      transferId:       event.transferId,
      validatorAddress: event.dstChain === 'tron'
        ? this.tronWeb.defaultAddress.base58 as string
        : this.evmWallet.address,
      signature,
      signedAt: new Date().toISOString(),
    };

    console.log(`[Validator] Signed transfer ${event.transferId} (${event.srcChain} → ${event.dstChain})`);
    return attestation;
  }

  // ─── Message hash construction ───────────────────────────────────────────

  /**
   * Builds the exact same hash the destination bridge contract will verify.
   * MUST match what the Solidity/TronBridge contract computes.
   */
  private buildMessageHash(event: LockEvent): string {
    if (event.dstChain === 'tron') {
      // Matches TronBridge._recoverSigner hash construction
      return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'string', 'uint256', 'string', 'bytes32'],
        [
          event.dstAddress,
          event.token,
          event.amount,
          event.srcChain,
          ethers.keccak256(ethers.toUtf8Bytes(`${event.srcChain}:${event.nonce}`)),
        ]
      ));
    }

    // Matches StablecoinBridge._hashRequest on EVM chains
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
      [
        event.sender,
        event.dstAddress,
        event.amount,
        this.chainIds[event.srcChain],
        this.chainIds[event.dstChain],
        event.nonce,
        event.deadline,
      ]
    ));
  }

  // ─── EVM signing ─────────────────────────────────────────────────────────

  private async signForEVM(messageHash: string): Promise<string> {
    // ethers v6: signMessage auto-prefixes with "\x19Ethereum Signed Message:\n32"
    return this.evmWallet.signMessage(ethers.getBytes(messageHash));
  }

  // ─── TRON signing ────────────────────────────────────────────────────────

  private async signForTron(messageHash: string): Promise<string> {
    // TronWeb uses "\x19TRON Signed Message:\n32" prefix (matches TronBridge)
    const signature = await this.tronWeb.trx.sign(messageHash);
    return signature;
  }

  // ─── On-chain verification ───────────────────────────────────────────────

  /**
   * Confirms the lock event actually happened on the source chain.
   * Prevents validators from signing fake events.
   */
  private async verifyLockOnChain(event: LockEvent): Promise<void> {
    if (event.srcChain === 'tron') {
      await this.verifyTronLock(event);
    } else {
      await this.verifyEVMLock(event);
    }
  }

  private async verifyEVMLock(event: LockEvent): Promise<void> {
    const rpcUrls: Record<string, string> = {
      ethereum: process.env.ETH_RPC!,
      bsc:      process.env.BSC_RPC!,
      polygon:  process.env.POLYGON_RPC!,
      sepolia:  process.env.ETH_RPC!,
    };

    const provider = new ethers.JsonRpcProvider(rpcUrls[event.srcChain]);

    // Query bridge contract for the TokensLocked event with this nonce
    const bridgeAddresses: Record<string, string> = {
      ethereum: process.env.ETH_BRIDGE_ADDRESS!,
      bsc:      process.env.BSC_BRIDGE_ADDRESS!,
      polygon:  process.env.POLYGON_BRIDGE_ADDRESS!,
      sepolia:  process.env.ETH_BRIDGE_ADDRESS!,
    };

    const bridge = new ethers.Contract(
      bridgeAddresses[event.srcChain],
      BRIDGE_EVENTS_ABI,
      provider
    );

    // Look at last 1000 blocks for the lock event
    const latest = await provider.getBlockNumber();
    const filter  = bridge.filters.TokensLocked(event.sender);
    const logs    = await bridge.queryFilter(filter, latest - 1000, latest);

    const found = logs.some(log => {
      const parsed = bridge.interface.parseLog(log);
      return (
        parsed?.args.nonce.toString()   === event.nonce.toString() &&
        parsed?.args.amount.toString()  === event.amount.toString() &&
        parsed?.args.dstChainId.toString() === this.chainIds[event.dstChain].toString()
      );
    });

    if (!found) {
      throw new Error(
        `[Validator] Lock event not found on-chain for transfer ${event.transferId}`
      );
    }
  }

  private async verifyTronLock(event: LockEvent): Promise<void> {
    // Query TRON bridge contract events
    const bridgeAddress = process.env.TRON_BRIDGE_ADDRESS!;
    const tronBridge    = await this.tronWeb.contract().at(bridgeAddress);

    // TronWeb event query
    const events = await this.tronWeb.getEventResult(bridgeAddress, {
      eventName: 'TokensLocked',
      limit: 20,
    }) as unknown as any[];

    const found = events?.some((e: any) =>
      e.result?.nonce    === event.nonce.toString() &&
      e.result?.amount   === event.amount.toString() &&
      e.result?.sender   === event.sender &&
      e.result?.dstChain === event.dstChain
    );

    if (!found) {
      throw new Error(
        `[Validator] TRON lock event not found for transfer ${event.transferId}`
      );
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  getEVMAddress():  string { return this.evmWallet.address; }
  getTRONAddress(): string { return this.tronWeb.defaultAddress.base58 as string; }
}

// Minimal ABI — only the event we need
const BRIDGE_EVENTS_ABI = [
  'event TokensLocked(address indexed from, uint256 amount, uint256 dstChainId, uint256 nonce)',
];