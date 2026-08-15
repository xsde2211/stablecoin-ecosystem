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

export const TRON_BRIDGE_ABI = [
  {
    inputs: [
      { internalType: 'string',  name: 'token',        type: 'string' },
      { internalType: 'uint256', name: 'amount',       type: 'uint256' },
      { internalType: 'string',  name: 'dstChain',     type: 'string' },
      { internalType: 'address', name: 'dstRecipient', type: 'address' },
      { internalType: 'uint256', name: 'nonce',        type: 'uint256' },
      { internalType: 'uint256', name: 'deadline',     type: 'uint256' },
    ],
    name: 'lock', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [
      { internalType: 'string',  name: 'token',        type: 'string' },
      { internalType: 'uint256', name: 'amount',       type: 'uint256' },
      { internalType: 'string',  name: 'srcChain',     type: 'string' },
      { internalType: 'address', name: 'srcRecipient', type: 'address' },
      { internalType: 'uint256', name: 'nonce',        type: 'uint256' },
      { internalType: 'uint256', name: 'deadline',     type: 'uint256' },
    ],
    name: 'burn', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [
      { internalType: 'string',   name: 'token',      type: 'string' },
      { internalType: 'address',  name: 'recipient',  type: 'address' },
      { internalType: 'uint256',  name: 'amount',     type: 'uint256' },
      { internalType: 'string',   name: 'srcChain',   type: 'string' },
      { internalType: 'bytes32',  name: 'srcNonce',   type: 'bytes32' },
      { internalType: 'bytes[]',  name: 'signatures', type: 'bytes[]' },
    ],
    name: 'mintTokens', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [
      { internalType: 'string',   name: 'token',      type: 'string' },
      { internalType: 'address',  name: 'recipient',  type: 'address' },
      { internalType: 'uint256',  name: 'amount',     type: 'uint256' },
      { internalType: 'string',   name: 'srcChain',   type: 'string' },
      { internalType: 'bytes32',  name: 'srcNonce',   type: 'bytes32' },
      { internalType: 'bytes[]',  name: 'signatures', type: 'bytes[]' },
    ],
    name: 'unlock', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [
      { internalType: 'string',  name: 'symbol',       type: 'string' },
      { internalType: 'address', name: 'contractAddr', type: 'address' },
    ],
    name: 'registerToken', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [], name: 'paused',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view', type: 'function',
  },
];

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);

  // EVM chain IDs
  private readonly chainIds: Record<string, bigint> = {
    ethereum: 11155111n, // Sepolia testnet
    bsc:      97n,       // BSC testnet
    polygon:  80002n,    // Polygon Amoy testnet
    tron:     3448148188n,
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

  // ─── Mode ────────────────────────────────────────────────────────────────
  //
  // MODE=TESTING   → the relayer signs with the validator private keys AND
  //                  executes mint/unlock itself, right after a successful
  //                  lock/burn — no human validator dashboard involved. This
  //                  is for local/dev testing only: it works because all the
  //                  validator + relayer private keys already live in this
  //                  service's own .env.
  // MODE=PRODUCTION (default, fail-safe if MODE is unset/misspelled) → after
  //                  a lock/burn confirms, the transfer stays LOCKED. The
  //                  validator dashboard (separate, in progress) is
  //                  responsible for real validators reviewing and signing
  //                  the request, and for eventually triggering mint/unlock
  //                  with those real signatures. This service does NOT
  //                  auto-sign or auto-execute in this mode.

  isTestingMode(): boolean {
    return (process.env.MODE ?? 'PRODUCTION').trim().toUpperCase() === 'TESTING';
  }

  // ─── Initiate (LOCK flow: srcChain → dstChain) ─────────────────────────────

  async initiate(userId: string, dto: InitiateBridgeDto) {
    if (dto.srcChain === dto.dstChain) {
      throw new BadRequestException('Source and destination chains must differ');
    }

    // Get user wallet address for srcChain — use whichever wallet the
    // request specifies (default: 0). Previously this was hardcoded to
    // walletIndex 0, so bridging always used wallet 1 no matter which
    // wallet was selected in the app.
    const walletIndex = dto.walletIndex ?? 0;
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain: dto.srcChain, walletIndex, isActive: true },
    });
    if (!wallet) {
      throw new BadRequestException(`No wallet found for chain: ${dto.srcChain} (walletIndex ${walletIndex}). Create a wallet first.`);
    }

    const nonce    = Date.now();
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    const transfer = await this.prisma.bridgeTransfer.create({
      data: {
        userId,
        walletId:   wallet.id, // ← was previously never set, so history/joins couldn't tell which wallet a transfer belonged to
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

    this.logger.log(`Bridge initiated: ${transfer.id} — ${dto.srcChain}→${dto.dstChain} (MODE=${this.isTestingMode() ? 'TESTING' : 'PRODUCTION'})`);
    return transfer;
  }

  // ─── Burn (BURN flow: user burns on dstChain to return to srcChain) ─────────

  async initiateBurn(userId: string, dto: BurnBridgeDto) {
    const walletIndex = dto.walletIndex ?? 0;
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, chain: dto.chain, walletIndex, isActive: true },
    });
    if (!wallet) throw new BadRequestException(`No wallet for chain: ${dto.chain} (walletIndex ${walletIndex})`);

    const nonce    = Date.now();
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const transfer = await this.prisma.bridgeTransfer.create({
      data: {
        userId,
        walletId:   wallet.id,
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

    this.logger.log(`Burn initiated: ${transfer.id} — ${dto.chain}→${dto.srcChain} (MODE=${this.isTestingMode() ? 'TESTING' : 'PRODUCTION'})`);
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

  async getUserTransfers(userId: string, page = 1, limit = 20, walletIndex?: number) {
    const skip = (page - 1) * limit;
    // Pass walletIndex to see only the active wallet's bridge history;
    // omit it (as before) to see all wallets' transfers.
    const where = {
      userId,
      ...(walletIndex !== undefined ? { wallet: { walletIndex } } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.bridgeTransfer.findMany({
        where,
        orderBy: { createdAt:'desc' },
        skip,
        take:    limit,
        include: { validatorSignatures: { select: { validatorAddr: true, signedAt: true } } },
      }),
      this.prisma.bridgeTransfer.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total/limit) };
  }

  // ─── Cross-chain address normalization ─────────────────────────────────────
  //
  // EVM bridge contracts store recipient/sender addresses as Solidity
  // `address` (a plain 20-byte value) — that's fine when the other chain is
  // also EVM, but a raw TRON base58 string ("T...") is NOT valid hex. When
  // ethers tries to ABI-encode a non-hex string as `address`, it assumes it
  // might be an ENS name and calls provider.resolveName() — which throws
  // "UNCONFIGURED_NAME" on any network without an ENS registry (which is
  // every testnet here). That's exactly what was breaking every
  // ethereum→tron (or tron-involved) bridge transfer.
  //
  // TRON addresses are really just a 20-byte EVM-style address wrapped in
  // base58check with a leading 0x41 prefix — so whenever the chain on the
  // "EVM side" of an address is actually tron, convert it to that raw
  // 20-byte hex form before it ever touches an EVM `address` parameter
  // (both for the actual on-chain call AND for computing the signature
  // hash — they must use the identical encoded value or signatures won't
  // recover to the right validator address on-chain).

  toTronEvmAddress(base58Address: string): string {
    const hex41 = TronWeb.address.toHex(base58Address); // "41" + 40 hex chars
    return '0x' + hex41.slice(2);
  }

  normalizeAddressForChain(address: string, chain: string): string {
    return chain === 'tron' ? this.toTronEvmAddress(address) : address;
  }

  // ─── Signing — matches contract's _hashRequest() + ECDSA.toEthSignedMessageHash exactly ───
  //
  // Contract: bytes32 msgHash = ECDSA.toEthSignedMessageHash(_hashRequest(req));
  //           _hashRequest = keccak256(abi.encode(tokenId, from, to, amount, srcChainId, dstChainId, nonce, deadline))
  // ethers' wallet.signMessage() applies the identical "\x19Ethereum Signed Message:\n32"
  // prefix that toEthSignedMessageHash does, so signing the raw inner hash here
  // reproduces exactly what hash.recover(sig) expects on-chain.
  //
  // NOTE: params.from / params.to MUST already be normalized via
  // normalizeAddressForChain() by the caller if the corresponding chain is
  // tron — this method has no way to know which side (if any) is tron.

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

  // TESTING-mode only: signs with the validator private keys configured in
  // THIS service's own .env, and also returns each signer's address so we
  // can persist real ValidatorSignature rows (previously this data was
  // generated and used to submit the mint/unlock tx but never saved
  // anywhere — the mobile app's "N / 2 validator signatures" display was
  // always stuck at 0/2 as a result).
  private async signBridgeRequest(
    req: ReturnType<BridgeService['buildBridgeRequest']>,
  ): Promise<{ signatures: string[]; signers: string[] }> {
    const innerHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
        [req.tokenId, req.from, req.to, req.amount, req.srcChainId, req.dstChainId, req.nonce, req.deadline],
      ),
    );

    // REQUIRED_VALIDATORS=2 on the deployed EVM contracts — use the first 2 of the
    // 3 configured EVM validator keys. All 3 are independently valid signers on-chain;
    // any 2-of-3 combination satisfies the threshold.
    // NOTE: these are the EVM-side validator keys (VALIDATOR_1/2/3_PRIVATE_KEY),
    // registered via addValidator() on the EVM StablecoinBridgeV2 contracts.
    // TRON has its OWN separately-registered validator set — see
    // signTronRequest() below, which correctly uses TRON_VALIDATOR_1/2/3_PRIVATE_KEY
    // instead. Mixing these up is exactly what caused "Bridge: invalid validator".
    const validatorKeys = [process.env.VALIDATOR_1_PRIVATE_KEY, process.env.VALIDATOR_2_PRIVATE_KEY]
      .filter((k): k is string => !!k);

    if (validatorKeys.length < 2) {
      throw new Error('Need at least 2 validator private keys configured (VALIDATOR_1_PRIVATE_KEY, VALIDATOR_2_PRIVATE_KEY)');
    }

    const wallets    = validatorKeys.map((key) => new ethers.Wallet(key));
    const signatures = await Promise.all(wallets.map((w) => w.signMessage(ethers.getBytes(innerHash))));
    const signers    = wallets.map((w) => w.address);
    return { signatures, signers };
  }

  private async recordValidatorSignatures(transferId: string, signers: string[], signatures: string[]) {
    await this.prisma.validatorSignature.createMany({
      data: signers.map((validatorAddr, i) => ({ transferId, validatorAddr, signature: signatures[i] })),
      skipDuplicates: true,
    });
  }

  private assertTestingMode(action: string) {
    if (!this.isTestingMode()) {
      throw new BadRequestException(
        `${action} is only available with MODE=TESTING. In production, a transfer stays LOCKED until ` +
        `the validator dashboard collects real validator signatures and submits them — this service does ` +
        `not self-sign or auto-execute in production.`,
      );
    }
  }

  // ─── Relayer: execute mint (TESTING mode: called automatically once a lock is confirmed) ───

  async executeMint(transferId: string) {
    this.assertTestingMode('executeMint');

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
      token: transfer.token,
      // srcAddress lives on transfer.srcChain, which could be tron (e.g. a
      // tron→ethereum bridge) — normalize before it touches an `address` field.
      from: this.normalizeAddressForChain(transfer.srcAddress, transfer.srcChain),
      to:   transfer.dstAddress, // dstChain is guaranteed EVM here (tron dst goes through executeTronMint instead)
      amount: transfer.amount, srcChain: transfer.srcChain, dstChain: transfer.dstChain,
      nonce: transfer.nonce, deadline: transfer.deadline,
    });
    const { signatures, signers } = await this.signBridgeRequest(req);

    await this.recordValidatorSignatures(transferId, signers, signatures);
    await this.prisma.bridgeTransfer.update({ where:{ id:transferId }, data:{ status:'SIGNATURES_COLLECTED' } });

    const tx      = await bridge.mint(req, signatures);
    const receipt = await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id:transferId },
      data:  { status:'COMPLETED', dstTxHash:receipt.hash },
    });

    this.logger.log(`[TESTING] Mint executed: ${receipt.hash}`);
    return { txHash:receipt.hash, status:'COMPLETED' };
  }

  // ─── Relayer: execute unlock (TESTING mode: called automatically once a burn is confirmed) ──

  async executeUnlock(transferId: string) {
    this.assertTestingMode('executeUnlock');

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
      // dstAddress here is the burner's address on the burn chain
      // (transfer.dstChain in BURN_UNLOCK convention), which could be tron.
      from: this.normalizeAddressForChain(transfer.dstAddress, transfer.dstChain),
      to: transfer.srcAddress,     // recipient of the unlocked funds, on the original chain — guaranteed EVM here
      amount: transfer.amount,
      srcChain: transfer.srcChain, // must equal the chain we're executing on
      dstChain: transfer.dstChain, // the burn chain
      nonce: transfer.nonce, deadline: transfer.deadline,
    });
    const { signatures, signers } = await this.signBridgeRequest(req);

    await this.recordValidatorSignatures(transferId, signers, signatures);
    await this.prisma.bridgeTransfer.update({ where:{ id:transferId }, data:{ status:'SIGNATURES_COLLECTED' } });

    const tx      = await bridge.unlock(req, signatures);
    const receipt = await tx.wait();

    await this.prisma.bridgeTransfer.update({
      where: { id:transferId },
      data:  { status:'COMPLETED', dstTxHash:receipt.hash },
    });

    this.logger.log(`[TESTING] Unlock executed: ${receipt.hash}`);
    return { txHash:receipt.hash, status:'COMPLETED' };
  }

  // ─── TRON completion ──────────────────────────────────────────────────────
  //
  // TronBridge.sol has a different interface than StablecoinBridgeV2.sol:
  // string token symbols instead of bytes32 tokenIds, and a single opaque
  // bytes32 srcNonce (that WE choose) instead of a struct the contract hashes
  // itself. The message hash is keccak256(abi.encodePacked(token, recipient,
  // amount, srcChain, srcNonce)) — matched exactly below via solidityPackedKeccak256.

  private async signTronRequest(
    token: string, recipientBase58: string, amount: bigint, srcChain: string, srcNonce: string,
  ): Promise<{ signatures: string[]; signers: string[] }> {
    const recipientEvmStyle = this.toTronEvmAddress(recipientBase58);
    const msgHash = ethers.solidityPackedKeccak256(
      ['string', 'address', 'uint256', 'string', 'bytes32'],
      [token, recipientEvmStyle, amount, srcChain, srcNonce],
    );

    // THE FIX: this was signing with VALIDATOR_1/2_PRIVATE_KEY — the EVM
    // validator keys — which are a completely different, separately
    // registered validator set from the ones added via addValidator() on
    // TronBridge. Since those signer addresses were never registered as
    // validators on the TRON contract, every signature check there failed
    // with "Bridge: invalid validator". TRON needs its own
    // TRON_VALIDATOR_1/2_PRIVATE_KEY (TRON_VALIDATOR_3_PRIVATE_KEY is also
    // available if you want a 2-of-3 pool there too — only 2 of whichever
    // are configured are actually used per signature round).
    const validatorKeys = [process.env.TRON_VALIDATOR_1_PRIVATE_KEY, process.env.TRON_VALIDATOR_2_PRIVATE_KEY]
      .filter((k): k is string => !!k);
    if (validatorKeys.length < 2) {
      throw new Error('Need at least 2 TRON validator private keys configured (TRON_VALIDATOR_1_PRIVATE_KEY, TRON_VALIDATOR_2_PRIVATE_KEY)');
    }
    const wallets    = validatorKeys.map((key) => new ethers.Wallet(key));
    const signatures = await Promise.all(wallets.map((w) => w.signMessage(ethers.getBytes(msgHash))));
    const signers    = wallets.map((w) => w.address);
    return { signatures, signers };
  }

  private async getTronBridge() {
    const tronWeb = new TronWeb({
      fullHost:   process.env.TRON_RPC!,
      privateKey: process.env.RELAYER_TRON_PRIVATE_KEY!,
    });
    // .contract().at(...) returns a Promise — must await it here, otherwise
    // callers get a Promise<ContractInstance> instead of the actual
    // contract, and calling .mintTokens()/.unlock() on a Promise doesn't
    // typecheck (or work at runtime).
    const bridge = await tronWeb.contract(TRON_BRIDGE_ABI, process.env.TRON_BRIDGE_V2_ADDRESS!);
    return { tronWeb, bridge };
  }

  // TronWeb's .send() only throws for BROADCAST-level failures (e.g. not
  // enough bandwidth/energy to even submit). It does NOT throw when the
  // contract call itself reverts on-chain — it just returns a txID either
  // way. That's exactly how a mint could log a real transaction hash while
  // zero tokens were ever actually minted (e.g. the relayer address wasn't
  // granted RELAYER_ROLE on TronBridge, the token wasn't registered there,
  // or a validator signer wasn't added via addValidator() on that specific
  // contract — TRON and EVM bridge deployments are configured separately).
  // So: poll for the transaction's real receipt and check receipt.result
  // ourselves — TRON blocks land roughly every 3s, hence the delay/attempts.
  //
  // THE FIX: this used to give up after 30s (15 attempts × 2s). That's
  // often not long enough for TronGrid to finish INDEXING a transaction
  // (as opposed to it being on-chain) — especially on the public Nile
  // testnet endpoint, which can lag well past 30s under load. When that
  // happens, getTransactionInfo() just keeps returning nothing (not a
  // FAILED result — nothing at all), so the loop exhausts and reports a
  // generic "not confirmed within 30s" — masking whatever the REAL revert
  // reason was, even though the receipt would have revealed it (as it did
  // here: "AccessControl: account ... is missing role ...") if we'd waited
  // long enough to actually see it. Bumped the budget way up and made it
  // configurable via TRON_CONFIRM_TIMEOUT_MS for different networks.
  async verifyTronTx(tronWeb: any, txId: string): Promise<void> {
    const pollIntervalMs = 2000;
    const timeoutMs      = Number(process.env.TRON_CONFIRM_TIMEOUT_MS) || 180_000; // 3 minutes
    const maxAttempts    = Math.ceil(timeoutMs / pollIntervalMs);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      let info: any;
      try {
        info = await tronWeb.trx.getTransactionInfo(txId);
      } catch {
        continue; // node hiccup — keep polling
      }

      if (!info || !info.id) {
        // Not indexed yet — let the person know we're still waiting rather
        // than going silent for up to 3 minutes.
        const elapsed = (attempt + 1) * pollIntervalMs / 1000;
        if ((attempt + 1) % 10 === 0) { // every ~20s
          this.logger.debug(`Still waiting on TRON tx ${txId} to be indexed (${elapsed}s elapsed)…`);
        }
        continue;
      }

      if (info.result === 'FAILED' || (info.receipt?.result && info.receipt.result !== 'SUCCESS')) {
        throw new Error(
          `TRON transaction ${txId} reverted on-chain: ${info.receipt?.result ?? info.result} ` +
          `— check the relayer has RELAYER_ROLE and the token/validators are registered on TronBridge`
        );
      }
      return; // confirmed with a successful receipt
    }
    throw new Error(
      `TRON transaction ${txId} was not confirmed within ${timeoutMs / 1000}s — check it manually on Tronscan. ` +
      `If it's still pending there too, TronGrid's indexing may just be slow right now; if it shows as reverted, ` +
      `see the failure reason on Tronscan for the real cause (this timeout doesn't necessarily mean it failed).`
    );
  }

  async executeTronMint(transferId: string) {
    this.assertTestingMode('executeTronMint');

    const transfer = await this.prisma.bridgeTransfer.findUnique({ where:{ id:transferId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'LOCKED') {
      throw new BadRequestException(`Transfer status is ${transfer.status}, expected LOCKED`);
    }

    const amount   = ethers.parseUnits(transfer.amount, 6);
    const srcNonce = ethers.keccak256(
      ethers.solidityPacked(['string', 'uint256'], [transfer.srcChain, BigInt(transfer.nonce)]),
    );
    const { signatures, signers } = await this.signTronRequest(transfer.token, transfer.dstAddress, amount, transfer.srcChain, srcNonce);

    await this.recordValidatorSignatures(transferId, signers, signatures);
    await this.prisma.bridgeTransfer.update({ where:{ id:transferId }, data:{ status:'SIGNATURES_COLLECTED' } });

    const { tronWeb, bridge } = await this.getTronBridge();
    const txId = await bridge.mintTokens(
      transfer.token, transfer.dstAddress, amount.toString(), transfer.srcChain, srcNonce, signatures,
    ).send({ feeLimit: 200_000_000 });

    // THE FIX: verify it actually succeeded before marking COMPLETED —
    // previously a silent on-chain revert still ended up as "COMPLETED"
    // with a real-looking txHash, and the user never received anything.
    await this.verifyTronTx(tronWeb, txId);

    await this.prisma.bridgeTransfer.update({
      where: { id:transferId },
      data:  { status:'COMPLETED', dstTxHash: txId },
    });

    this.logger.log(`[TESTING] TRON mint confirmed: ${txId}`);
    return { txHash: txId, status:'COMPLETED' };
  }

  async executeTronUnlock(transferId: string) {
    this.assertTestingMode('executeTronUnlock');

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
    const { signatures, signers } = await this.signTronRequest(transfer.token, transfer.srcAddress, amount, transfer.dstChain, srcNonce);

    await this.recordValidatorSignatures(transferId, signers, signatures);
    await this.prisma.bridgeTransfer.update({ where:{ id:transferId }, data:{ status:'SIGNATURES_COLLECTED' } });

    const { tronWeb, bridge } = await this.getTronBridge();
    const txId = await bridge.unlock(
      transfer.token, transfer.srcAddress, amount.toString(), transfer.dstChain, srcNonce, signatures,
    ).send({ feeLimit: 200_000_000 });

    await this.verifyTronTx(tronWeb, txId);

    await this.prisma.bridgeTransfer.update({
      where: { id:transferId },
      data:  { status:'COMPLETED', dstTxHash: txId },
    });

    this.logger.log(`[TESTING] TRON unlock confirmed: ${txId}`);
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