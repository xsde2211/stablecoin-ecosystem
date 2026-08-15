import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression }              from '@nestjs/schedule';
import { ethers }                            from 'ethers';
import { TronWeb }                           from 'tronweb';
import { PrismaService }                     from '../prisma/prisma.service';
import { RedisService }                      from '../redis/redis.service';
import axios from 'axios';

// ─── Contract ABIs ──────────────────────────────────────────────────────────────

// ERC20/TRC20 Transfer event — for detecting payments and wallet transactions
const ERC20_TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

// BridgeV2 events — matches StablecoinBridgeV2.sol
const BRIDGE_V2_ABI = [
  'event TokensLocked(bytes32 indexed tokenId, address indexed from, uint256 amount, uint256 dstChainId, address dstRecipient, uint256 nonce, uint256 deadline)',
  'event TokensMinted(bytes32 indexed tokenId, address indexed to, uint256 amount, uint256 srcChainId, bytes32 nonceKey)',
  'event TokensBurned(bytes32 indexed tokenId, address indexed from, uint256 amount, uint256 srcChainId, address srcRecipient, uint256 nonce, uint256 deadline)',
  'event TokensUnlocked(bytes32 indexed tokenId, address indexed to, uint256 amount, uint256 dstChainId, bytes32 nonceKey)',
];

const TOKEN_IDS_TO_SYMBOL: Record<string,string> = {
  [ethers.keccak256(ethers.toUtf8Bytes('INRX'))]:  'INRX',
  [ethers.keccak256(ethers.toUtf8Bytes('EGOLD'))]: 'EGOLD',
  [ethers.keccak256(ethers.toUtf8Bytes('ESLVR'))]: 'ESLVR',
};

const CHAIN_ID_TO_NAME: Record<string,string> = {
  '11155111':  'ethereum',
  '97':        'bsc',
  '80002':     'polygon',
  '3448148188': 'tron',
};



@Injectable()
export class ListenerService implements OnModuleInit {
  private readonly logger = new Logger(ListenerService.name);

  // Track last processed block per chain to avoid re-scanning
  private lastBlocks: Record<string, number> = {}; //eg { ethereum_tokens: 12345678, bsc_tokens: 9876543 } So next polling starts from block 12346 instead of block 0, Without it, every poll would scan the blockchain from the beginning.
  private lastTronEventTs: Record<string, number> = {}; //store timestamp of last processed tron event eg { INRX: 1690000000000, EGOLD: 1690000000000 } So next polling starts from timestamp 1690000000000 instead of timestamp 0, Without it, every poll would scan the blockchain from the beginning.

  // create prisma and redis service instances and now can access them using this.prisma and this.redis
  constructor(
    private prisma: PrismaService,
    private redis:  RedisService
  ) {}

  //called once when application starts
  async onModuleInit() {
    this.logger.log('Listener service initializing — setting up WebSocket subscriptions');

    // Set up real-time WebSocket listeners for EVM chains (where WSS available)
    await this.setupEVMWebsocketListeners();
    // Watch plain token Transfer events (wallet sends/receives) on chains with WSS
    await this.setupTokenTransferListeners();
    // Initialize last-block tracking for polling-based chains (TRON, fallback EVM)
    await this.initLastBlocks();

    this.logger.log('Listener service ready');
  }

  // ─── WebSocket listeners (real-time, for chains with WSS RPC) ────────────────
  // eth,polygon uses WebSocketProvider to listen for events in real-time, instead of polling every 60s. This is faster and more efficient, but requires a WSS RPC endpoint. If the WSS connection drops, it will automatically reconnect and re-subscribe to events. 
  // tron and bsc uses polling
  // below function is for eth,polygon using websocket
  private async setupEVMWebsocketListeners() {
    const wsConfigs = [
      { chain:'ethereum', wsUrl: process.env.ETH_WS_RPC,     bridgeAddr: process.env.ETH_BRIDGE_V2_ADDRESS },
      { chain:'polygon',  wsUrl: process.env.POLYGON_WS_RPC, bridgeAddr: process.env.POLYGON_BRIDGE_V2_ADDRESS },
    ];

    for (const cfg of wsConfigs) {
      if (!cfg.wsUrl || !cfg.bridgeAddr) {
        this.logger.warn(`Skipping WS listener for ${cfg.chain} — missing WS RPC or bridge address`);
        continue;
      }
      this.connectBridgeWs(cfg.chain, cfg.wsUrl, cfg.bridgeAddr);
    }
  }

  // Sets up (or re-sets-up, after a dropped connection) the bridge-events WS
  // listener for one chain. Split out from setupEVMWebsocketListeners so the
  // reconnect handler below can call it again on its own.
  private readonly EVM_CHAIN_IDS: Record<string, number> = {
    ethereum: 11155111,
    bsc:      97,
    polygon:  80002,
  };

  // Our listener service maintains a WebSocket connection to an Ethereum/Polygon node, 
  // and that node streams our bridge contract's events to the service in real time
  private connectBridgeWs(chain: string, wsUrl: string, bridgeAddr: string) {
    try {
      const provider = new ethers.WebSocketProvider(
        wsUrl, //websocket endpoint for that blockchain node
        this.EVM_CHAIN_IDS[chain] ? ethers.Network.from(this.EVM_CHAIN_IDS[chain]) : undefined, //specify which network this provider connected to
      );
      this.attachWsResilience(chain, 'bridge', provider, () => this.connectBridgeWs(chain, wsUrl, bridgeAddr));

      const bridge = new ethers.Contract(bridgeAddr, BRIDGE_V2_ABI, provider);

      bridge.on('TokensLocked', (...args) => this.handleLockEvent(chain, args));
      bridge.on('TokensMinted', (...args) => this.handleMintEvent(chain, args));
      bridge.on('TokensBurned', (...args) => this.handleBurnEvent(chain, args));
      bridge.on('TokensUnlocked', (...args) => this.handleUnlockEvent(chain, args));

      this.logger.log(`WebSocket listener active for ${chain} bridge: ${bridgeAddr}`);
    } catch (err: any) {
      this.logger.error(`Failed to set up WS listener for ${chain}: ${err.message}`);
      this.scheduleWsReconnect(chain, 'bridge', () => this.connectBridgeWs(chain, wsUrl, bridgeAddr));
    }
  }

  //store ws reconnect attempts for each chain , eg: { 'ethereum:bridge': 3, 'polygon:bridge': 1 } means ethereum bridge ws has reconnected 3 times and polygon bridge ws has reconnected 1 time
  private wsReconnectAttempts: Record<string, number> = {};

  //difference in attachWsResilience and scheduleWsReconnect is that attachwsresilience watched websocket for failures and schedulewsreconnect manages reconnect after failure detect
  //agar websocket connection drop ho jaye to ye function websocket ko reconnect karne ke liye use hota hai, aur agar 10 attempts ke baad bhi reconnect nahi hota to polling method pe rely karega
  private attachWsResilience(
    chain: string,
    label: string,
    provider: ethers.WebSocketProvider,
    reconnect: () => void,
  ) {
    const socket: any = (provider as any).websocket;
    if (!socket || typeof socket.on !== 'function') return;

    socket.on('error', (err: any) => {
      this.logger.warn(`[${chain}] ${label} WebSocket error (will retry): ${err?.message ?? err}`);
    });
    socket.on('close', () => {
      this.logger.warn(`[${chain}] ${label} WebSocket closed — scheduling reconnect`);
      this.scheduleWsReconnect(chain, label, reconnect);
    });
    socket.once('open', () => {
      this.wsReconnectAttempts[`${chain}:${label}`] = 0;
    });
  }

  // Schedule a reconnect attempt with exponential backoff, capped at 30s. After 10 failed attempts, give up and rely on polling only.
  private scheduleWsReconnect(chain: string, label: string, reconnect: () => void) {
    const key = `${chain}:${label}`;
    const attempt = (this.wsReconnectAttempts[key] ?? 0) + 1;
    this.wsReconnectAttempts[key] = attempt;

    if (attempt > 10) {
      this.logger.error(
        `[${chain}] ${label}: giving up on WebSocket reconnects after ${attempt} attempts — ` +
        `relying on HTTPS polling only for this chain until the app restarts.`,
      );
      return;
    }

    //attempt 1: 2^1 * 1000 = wait for 2000ms, attempt 2: 2^2 * 1000 = 4000ms, attempt 3: 2^3 * 1000 = 8000ms, attempt 4: 2^4 * 1000 = 16000ms, attempt 5: 2^5 * 1000 = 32000ms (capped at 30000ms)
    const delay = Math.min(30000, 1000 * 2 ** attempt); 
    this.logger.debug(`[${chain}] ${label}: reconnecting WebSocket in ${delay}ms (attempt ${attempt}/10)`);
    setTimeout(reconnect, delay); 
  }

  // here these 4 function update status of bridge transfer(pending,locked,completed) in the database
  // and then they publish the event to redis so that bridge service can listen to it and proceed with the next step of the transfer
  // these function are called when transfer happened on contract and we want to update database and notify bridge service to proceed with next step of transfer
  private async handleLockEvent(chain: string, args: any[]) {
    const [tokenId, from, amount, dstChainId, dstRecipient, nonce, deadline, event] = args;
    const symbol   = TOKEN_IDS_TO_SYMBOL[tokenId] ?? 'UNKNOWN';
    const dstChain = CHAIN_ID_TO_NAME[dstChainId.toString()] ?? 'unknown';

    this.logger.log(`[${chain}] TokensLocked: ${symbol} ${ethers.formatUnits(amount,6)} from ${from} → ${dstChain}/${dstRecipient} (nonce=${nonce})`);

    // Find matching pending BridgeTransfer by nonce + srcChain
    const transfer = await this.prisma.bridgeTransfer.findFirst({
      where: { srcChain:chain, nonce:nonce.toString(), status:{ in:['PENDING','LOCKED'] } },
    });

    if (transfer) {
      //status: pending -> locked
      await this.prisma.bridgeTransfer.update({
        where: { id: transfer.id },
        data:  { status:'LOCKED', srcTxHash: event?.log?.transactionHash ?? event?.transactionHash },
      });
      this.logger.log(`Bridge transfer ${transfer.id} confirmed LOCKED on ${chain}`);

      // Notify bridge-service to proceed with relayer mint via Redis pub/sub, bridge service receive this using redis.subscribe('bridge:locked')
      await this.redis.publish('bridge:locked', JSON.stringify({
        transferId: transfer.id, chain, symbol, amount: ethers.formatUnits(amount,6),
      }));
    }
  }

  private async handleMintEvent(chain: string, args: any[]) {
    const [tokenId, to, amount, srcChainId, nonceKey, event] = args;
    const symbol = TOKEN_IDS_TO_SYMBOL[tokenId] ?? 'UNKNOWN';

    this.logger.log(`[${chain}] TokensMinted: ${symbol} ${ethers.formatUnits(amount,6)} → ${to} (nonceKey=${nonceKey})`);

    const transfer = await this.prisma.bridgeTransfer.findFirst({
      where: { dstChain:chain, status:'LOCKED', dstAddress:to },
      orderBy: { createdAt:'desc' },
    });

    if (transfer) {
      //status: locked -> completed
      await this.prisma.bridgeTransfer.update({
        where: { id: transfer.id },
        data:  { status:'COMPLETED', dstTxHash: event?.log?.transactionHash ?? event?.transactionHash },
      });
      this.logger.log(`Bridge transfer ${transfer.id} COMPLETED on ${chain}`);

      await this.redis.publish('bridge:completed', JSON.stringify({
        transferId: transfer.id, chain, symbol, amount: ethers.formatUnits(amount,6),
      }));
    }
  }

  //Pending to locked 
  private async handleBurnEvent(chain: string, args: any[]) {
    const [tokenId, from, amount, srcChainId, srcRecipient, nonce, deadline, event] = args;
    const symbol    = TOKEN_IDS_TO_SYMBOL[tokenId] ?? 'UNKNOWN';
    const srcChain  = CHAIN_ID_TO_NAME[srcChainId.toString()] ?? 'unknown';

    this.logger.log(`[${chain}] TokensBurned: ${symbol} ${ethers.formatUnits(amount,6)} from ${from} → unlock on ${srcChain}/${srcRecipient}`);

    const transfer = await this.prisma.bridgeTransfer.findFirst({
      where: { dstChain:chain, srcChain, nonce:nonce.toString(), status:{ in:['PENDING','LOCKED'] }, type:'BURN_UNLOCK' },
    });

    if (transfer) {
      await this.prisma.bridgeTransfer.update({
        where: { id: transfer.id },
        data:  { status:'LOCKED', srcTxHash: event?.log?.transactionHash ?? event?.transactionHash }, //here status locked doesnt mean that tokens are locked on the source chain, it means that the burn transaction is confirmed on the destination chain and now the relayer can proceed to unlock the tokens on the source chain
      });
      await this.redis.publish('bridge:burned', JSON.stringify({
        transferId: transfer.id, chain, symbol, amount: ethers.formatUnits(amount,6),
      }));
    }
  }

  //locked to completed
  private async handleUnlockEvent(chain: string, args: any[]) {
    const [tokenId, to, amount, dstChainId, nonceKey, event] = args;
    const symbol = TOKEN_IDS_TO_SYMBOL[tokenId] ?? 'UNKNOWN';

    this.logger.log(`[${chain}] TokensUnlocked: ${symbol} ${ethers.formatUnits(amount,6)} → ${to}`);

    const transfer = await this.prisma.bridgeTransfer.findFirst({
      where: { srcChain:chain, status:'LOCKED', srcAddress:to, type:'BURN_UNLOCK' },
      orderBy: { createdAt:'desc' },
    });

    if (transfer) {
      await this.prisma.bridgeTransfer.update({
        where: { id: transfer.id },
        data:  { status:'COMPLETED', dstTxHash: event?.log?.transactionHash ?? event?.transactionHash },
      });
      await this.redis.publish('bridge:completed', JSON.stringify({
        transferId: transfer.id, chain, symbol, amount: ethers.formatUnits(amount,6),
      }));
    }
  }
/*
Example:                                        
our Listener
      │
      │ "Subscribe to TokensLocked
      │  on contract 0x1234..."
      ▼
Ethereum Node
      │
      │ Watches every new block
      ▼
Blockchain
      │
      ├── Contract A emits Transfer
      ├── Contract B emits Approval
      ├── Your Bridge emits TokensLocked ✅
      └── Contract C emits Mint
      │
      ▼
Node checks filter
      │
      ├── Transfer ❌ Ignore
      ├── Approval ❌ Ignore
      ├── TokensLocked ✅ Send to your listener
      └── Mint ❌ Ignore

So your service only receives events that match the filter.

HOW ABOVE FUNCTION WORKS IN ORDER:
1. connectBridgeWs()
        │
        ▼
2. Create WebSocketProvider
        │
        ▼
3. attachWsResilience()
        │
        ▼
4. WebSocket running...
        │
        ▼
5. Internet disconnects
        │
        ▼
6. socket emits "close"
        │
        ▼
7. attachWsResilience detects it
        │
        ▼
8. Calls scheduleWsReconnect()
        │
        ▼
9. Wait 2 seconds
        │
        ▼
10. Calls reconnect()
        │
        ▼
11. connectBridgeWs()
        │
        ▼
12. New WebSocketProvider created
        │
        ▼
13. attachWsResilience() attaches listeners again
*/

//---------------------------------------------------------------------------------------------------------
  // ─── WebSocket listeners for plain token Transfer events (wallet send/receive) ─

  private async setupTokenTransferListeners() {
    const wsConfigs = [
      { chain: 'ethereum', wsUrl: process.env.ETH_WS_RPC },
      { chain: 'polygon',  wsUrl: process.env.POLYGON_WS_RPC },
    ];

    for (const cfg of wsConfigs) {
      if (!cfg.wsUrl) {
        this.logger.warn(`Skipping token WS listener for ${cfg.chain} — missing WS RPC`);
        continue;
      }
      this.connectTokenWs(cfg.chain, cfg.wsUrl);
    }
  }

  // Sets up (or re-sets-up, after a dropped connection) the token-transfer WS
  // listener for one chain. Split out so the reconnect handler can call it again.
  private connectTokenWs(chain: string, wsUrl: string) {
    const TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;
    try {
      const provider = new ethers.WebSocketProvider(
        wsUrl,
        this.EVM_CHAIN_IDS[chain] ? ethers.Network.from(this.EVM_CHAIN_IDS[chain]) : undefined,
      );
      this.attachWsResilience(chain, 'tokens', provider, () => this.connectTokenWs(chain, wsUrl));

      for (const symbol of TOKENS) {
        const tokenAddr = this.getTokenAddress(chain, symbol);
        if (!tokenAddr) {
          this.logger.warn(`Skipping ${chain}/${symbol} token listener — address not configured`);
          continue;
        }

        const contract = new ethers.Contract(tokenAddr, ERC20_TRANSFER_ABI, provider);
        contract.on('Transfer', (from: string, to: string, value: bigint, event: any) => {
          const txHash      = event?.log?.transactionHash ?? event?.transactionHash;
          const blockNumber = event?.log?.blockNumber ?? event?.blockNumber ?? 0;
          this.handleTokenTransfer(chain, symbol, from, to, value, txHash, blockNumber)
            .catch(err => this.logger.error(`handleTokenTransfer error [${chain}/${symbol}]: ${err.message}`));
        });

        this.logger.log(`Token WS listener active for ${chain}/${symbol}: ${tokenAddr}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to set up token WS listener for ${chain}: ${err.message}`);
      this.scheduleWsReconnect(chain, 'tokens', () => this.connectTokenWs(chain, wsUrl));
    }
  }


// ─── Shared handler — confirms sends, records receives, for any chain/token ───

  private async handleTokenTransfer(
    chain: string, symbol: string, from: string, to: string,
    value: bigint, txHash: string, blockNumber: number,
  ) {
    if (!txHash) return;
 
    const cacheKey = `token:transfer:${chain}:${txHash.toLowerCase()}:${symbol}`;
    if (await this.redis.exists(cacheKey)) return;
    await this.redis.set(cacheKey, '1', 86400);
 
    const amount   = ethers.formatUnits(value, 6);
    const fromNorm = chain === 'tron' ? this.normalizeTronAddress(from) : from.toLowerCase();
    const toNorm   = chain === 'tron' ? this.normalizeTronAddress(to)   : to.toLowerCase();
    // Normalize txHash to lowercase for consistent DB matching
    const txHashNorm = txHash.toLowerCase();
 
    // Confirm PENDING SEND — match txHash case-insensitively
    const updated = await this.prisma.transaction.updateMany({
      where: {
        txHash:  { equals: txHashNorm, mode: 'insensitive' },
        status:  'PENDING',
      },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), blockNumber: BigInt(blockNumber) },
    });
    if (updated.count > 0) {
      this.logger.log(`[${chain}] Confirmed ${symbol} SEND tx ${txHashNorm} (${amount})`);
    }
 
    // Create RECEIVE row for recipient if they're one of our users
    const wallet = chain === 'tron'
      ? await this.prisma.wallet.findFirst({ where: { address: toNorm, chain } })
      : await this.prisma.wallet.findFirst({
          where: { address: { equals: toNorm, mode: 'insensitive' }, chain },
        });
 
    if (!wallet) {
      this.logger.log(
        `[${chain}] No wallet found for RECEIVE candidate ${toNorm} (${symbol} ${txHashNorm}) — not one of our users, or an address-normalization mismatch`
      );
      return;
    };

    const isBridgeLeg = await this.prisma.bridgeTransfer.findFirst({
      where: {
        OR: [
          { srcTxHash: { equals: txHashNorm, mode: 'insensitive' } },
          { dstTxHash: { equals: txHashNorm, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (isBridgeLeg) {
      this.logger.log(`[${chain}] Skipping RECEIVE for ${txHashNorm} — already represented as a bridge transfer leg`);
      return;
    }

    // swap-service/stablecoin-service can beat this poller to inserting a
    // row for the same (walletId, txHash) — a burn/mint/swap leg IS a
    // token Transfer on-chain, so this same handler sees it too. Unlike
    // their upserts (which deliberately correct a generic RECEIVE/SEND
    // guess into the more specific SWAP/MINT/BURN), this one must NOT
    // clobber their type back to RECEIVE on conflict — it only exists here
    // to confirm block info on whichever row already exists. create()
    // with a catch on 'Unique constraint' used to "handle" the race, but
    // Prisma logs the underlying P2002 internally the moment the insert
    // fails regardless of the catch — upsert() avoids that entirely since
    // no exception is thrown on conflict in the first place.
    try {
      await this.prisma.transaction.upsert({
        where: { walletId_txHash: { walletId: wallet.id, txHash: txHashNorm } },
        create: {
          walletId:    wallet.id,
          txHash:      txHashNorm,
          chain,
          type:        'RECEIVE',
          amount,
          tokenSymbol: symbol,
          fromAddress: fromNorm,
          toAddress:   toNorm,
          status:      'CONFIRMED',
          confirmedAt: new Date(),
          blockNumber: BigInt(blockNumber),
        },
        update: {
          status:      'CONFIRMED',
          confirmedAt: new Date(),
          blockNumber: BigInt(blockNumber),
        },
      });
      this.logger.log(`[${chain}] Recorded RECEIVE ${symbol} ${txHashNorm} → wallet ${wallet.id}`);
    } catch (err: any) {
      this.logger.error(`Failed to record RECEIVE ${txHashNorm}: ${err.message}`);
    }
  }

  // ─── Polling fallback — runs for ALL EVM chains, not just BSC ─────────────────
  //
  // WS subscriptions (setupTokenTransferListeners) are fast when they work, but
  // ethers WebSocketProvider connections can silently stop delivering events
  // (idle timeouts, provider-side drops, reconnect failures) without throwing —
  // so nothing in the app would ever see an error. Polling over plain HTTPS RPC
  // is far more reliable and easy to debug, so it now runs for every EVM chain
  // as the primary confirmation path; WS is just a low-latency bonus on top.

  // Guards against overlapping runs: if a poll cycle is still working through
  // a rate-limited chain when the next 60s tick fires, NestJS's @Cron does
  // NOT wait for the previous run to finish — it just fires again. Two (or
  // three) concurrent pollers hammering the same already-rate-limited BSC
  // endpoint was exactly what produced interleaved, ever-shrinking window
  // logs that never made progress. This flag makes a tick that finds a
  // previous one still running skip itself entirely instead of piling on.
  private evmPollBusy = false;

  @Cron('0 */3 * * * *') // every 3 minutes
  async pollEvmTokenTransfersAll() {
    if (this.evmPollBusy) {
      this.logger.debug('Previous EVM token poll still running — skipping this tick');
      return;
    }
    this.evmPollBusy = true;
    try {
      const chains: Array<[string, string | undefined]> = [
        ['ethereum', process.env.ETH_RPC],
        ['polygon',  process.env.POLYGON_RPC],
        ['bsc',      process.env.BSC_RPC],
      ];

      for (const [chain, rpcUrl] of chains) {
        if (!rpcUrl) {
          this.logger.warn(`Skipping token polling for ${chain} — no RPC URL configured`);
          continue;
        }
        try {
          await new Promise(r => setTimeout(r, 3000));
          await this.pollEvmTokenTransfers(chain, rpcUrl);
        } catch (err: any) {
          this.logger.error(`${chain} token polling error: ${err.message}`);
        }
      }
    } finally {
      this.evmPollBusy = false;
    }
  }

  // How many blocks to request per eth_getLogs call. Just a starting guess
  // for large catch-up ranges — getLogsWithRetry() below discovers each
  // chain's REAL cap on the fly (see discoveredMaxRange) whenever a node
  // rejects a request as too wide, so this doesn't need to be exact.
  private readonly MAX_LOG_RANGE: Record<string, number> = {
    bsc:      300,
    ethereum: 400,
    polygon:  400,
  };

  // Once a chain tells us its actual eth_getLogs range cap (see
  // isBlockRangeError below), we remember it here so every subsequent
  // chunk — this cycle and future ones — starts at a size that's already
  // known to work, instead of re-discovering it by trial and error every
  // single poll.
  private discoveredMaxRange: Record<string, number> = {};

  // Pause between eth_getLogs calls on the same chain within one poll cycle.
  private readonly CHAIN_POLL_DELAY: Record<string, number> = {
    bsc: 800,
  };

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRateLimitError(err: any): boolean {
    const code = err?.error?.code ?? err?.code;
    const msg  = String(err?.error?.message ?? err?.shortMessage ?? err?.message ?? '');
    return code === -32005 || /limit exceeded|too many requests|rate limit/i.test(msg);
  }

  // Distinct from a rate limit: this is the RPC node stating a hard,
  // deterministic cap on how many blocks one eth_getLogs call may span
  // (Polygon Amoy's public RPC does this — e.g. "block range exceeds
  // configured limit"). Unlike a frequency-based rate limit, shrinking the
  // window is exactly the right response here, and it's safe to retry
  // immediately since it isn't a "slow down" signal.
  private isBlockRangeError(err: any): boolean {
    const code = err?.error?.code ?? err?.code;
    const msg  = String(err?.error?.message ?? err?.shortMessage ?? err?.message ?? '');
    return code === -32000 && /block range|range exceeds|range limit|too many blocks|query returned more than/i.test(msg)
      || /block range exceeds|exceeds configured limit/i.test(msg);
  }

  // One eth_getLogs call for a block window, handling two distinct failure
  // modes differently:
  //  - Rate limit (transient, frequency-based): retry the SAME window with
  //    flat backoff delay. Shrinking wouldn't help — a single block was
  //    rate-limited just as often as a 20-block one on BSC, so the fix is
  //    to slow down, not send more (smaller) requests.
  //  - Block-range-exceeded (deterministic, size-based): the node is
  //    telling us its actual cap, so halve the window and retry
  //    immediately — no need to wait. Once it succeeds, remember that
  //    smaller size for this chain so future chunks don't have to
  //    rediscover it.
  // Returns however far it actually got — `reachedBlock` may be less than
  // the originally requested `toBlock` if the window had to shrink.
  private async getLogsWithRetry(
    provider: ethers.JsonRpcProvider,
    addresses: string[],
    transferTopic: string,
    fromBlock: number,
    toBlock: number,
    chain: string,
  ): Promise<{ logs: ethers.Log[]; reachedBlock: number }> {
    let windowEnd = toBlock;
    const maxRateLimitAttempts = 3;
    let rateLimitAttempt = 0;

    for (let shrinkAttempt = 0; shrinkAttempt < 8; shrinkAttempt++) {
      try {
        const logs = await provider.getLogs({ address: addresses, topics: [transferTopic], fromBlock, toBlock: windowEnd });
        if (windowEnd < toBlock) {
          this.discoveredMaxRange[chain] = windowEnd - fromBlock + 1;
          this.logger.debug(`[${chain}] discovered working eth_getLogs range: ${this.discoveredMaxRange[chain]} blocks`);
        }
        return { logs, reachedBlock: windowEnd };
      } catch (err: any) {
        if (this.isBlockRangeError(err) && windowEnd > fromBlock) {
          windowEnd = fromBlock + Math.floor((windowEnd - fromBlock) / 2);
          this.logger.debug(`[${chain}] block range too wide, shrinking to blocks ${fromBlock}-${windowEnd} and retrying`);
          continue;
        }
        if (this.isRateLimitError(err) && rateLimitAttempt < maxRateLimitAttempts - 1) {
          rateLimitAttempt++;
          const backoff = 1500 * rateLimitAttempt;
          this.logger.debug(`[${chain}] eth_getLogs rate-limited, retrying blocks ${fromBlock}-${windowEnd} in ${backoff}ms (attempt ${rateLimitAttempt}/${maxRateLimitAttempts - 1})`);
          await this.sleep(backoff);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`[${chain}] could not find a working eth_getLogs range starting from block ${fromBlock}`);
  }

  private async pollEvmTokenTransfers(chain: string, rpcUrl: string) {
    if (!rpcUrl) return;
    const TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;
    const provider = this.getProvider(chain);

    const currentBlock = await provider.getBlockNumber();
    const key          = `${chain}_tokens`;
    const fromBlock    = this.lastBlocks[key] ?? currentBlock - 20;
    if (currentBlock <= fromBlock) return;

    // Collect every configured token address for this chain so we issue ONE
    // eth_getLogs call per block-window instead of one per token. Doing 3
    // separate calls every 60s (x3 chains) was exactly what tripped "Too
    // Many Requests" / "triggered rate limit" on Infura's free tier and the
    // public BSC testnet node — a single multi-address query covers the
    // same ground for a third of the request volume.
    const addrToSymbol: Record<string, typeof TOKENS[number]> = {};
    for (const symbol of TOKENS) {
      const addr = this.getTokenAddress(chain, symbol);
      if (!addr) {
        this.logger.warn(`Skipping ${chain}/${symbol} poll — token address not configured`);
        continue;
      }
      addrToSymbol[addr.toLowerCase()] = symbol;
    }

    const addresses = Object.keys(addrToSymbol);
    if (addresses.length === 0) { this.lastBlocks[key] = currentBlock; return; }

    const iface         = new ethers.Interface(ERC20_TRANSFER_ABI);
    const transferTopic = iface.getEvent('Transfer')!.topicHash;
    // Prefer a range this chain has already proven it accepts, if we've
    // discovered one; otherwise fall back to the initial guess.
    const maxRange       = this.discoveredMaxRange[chain] ?? this.MAX_LOG_RANGE[chain] ?? 200;
    const pollDelay       = this.CHAIN_POLL_DELAY[chain] ?? 300;

    // Walk the block range in windows. `caughtUpTo` only advances past a
    // window once that window's query actually succeeds — marking the
    // ENTIRE range as processed even when the call failed would silently
    // drop any transfers in that window forever. A failed/rate-limited
    // window is left for the next poll cycle to retry.
    let windowStart = fromBlock + 1;
    let caughtUpTo  = fromBlock;

    while (windowStart <= currentBlock) {
      const windowEnd = Math.min(windowStart + maxRange - 1, currentBlock);

      try {
        const { logs, reachedBlock } = await this.getLogsWithRetry(provider, addresses, transferTopic, windowStart, windowEnd, chain);

        if (logs.length > 0) {
          this.logger.debug(`[${chain}] Found ${logs.length} token Transfer event(s) in blocks ${windowStart}-${reachedBlock}`);
        }

        for (const log of logs) {
          const symbol = addrToSymbol[log.address.toLowerCase()];
          if (!symbol) continue;
          try {
            const parsed = iface.parseLog(log);
            if (!parsed) continue;
            const [from, to, value] = parsed.args as unknown as [string, string, bigint];
            this.logger.debug(`[${chain}] ${symbol} Transfer ${log.transactionHash}: ${from} → ${to} (${value})`);
            await this.handleTokenTransfer(chain, symbol, from, to, value, log.transactionHash, log.blockNumber);
          } catch (err: any) {
            this.logger.warn(`Failed to parse/handle ${chain} log ${log.transactionHash}: ${err.message}`);
          }
        }

        caughtUpTo  = reachedBlock;
        windowStart = reachedBlock + 1;

        // Brief pause between chunked calls so we don't immediately re-hit
        // the same per-second rate limit that just got us here.
        if (windowStart <= currentBlock) await this.sleep(pollDelay);
      } catch (err: any) {
        this.logger.warn(`Token poll failed [${chain}] blocks ${windowStart}-${windowEnd}: ${err.message}`);
        break; // stop for this cycle — remaining blocks retried next time
      }
    }

    this.lastBlocks[key] = caughtUpTo;
  }

  // ─── Polling fallback — TRON (no native WSS event subscriptions) ──────────────

  @Cron('*/30 * * * * *') // every 30 seconds
  async pollTronTokenTransfers() {
    const TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;

    for (const symbol of TOKENS) {
      const tokenAddr = this.getTokenAddress('tron', symbol);
      if (!tokenAddr) continue;

      // Anchored to the last event actually processed for this token, not
      // wall-clock time or a fixed page size. TronGrid's events endpoint
      // defaults to order_by=block_timestamp,desc with limit=20 — with
      // only_confirmed=true, an event needs time to solidify before it
      // even appears, and if 20+ *other* transfers land on the same
      // contract in that window (easy on a heavily-tested token), the
      // still-unconfirmed one falls out of "most recent 20" and is never
      // seen again. Walking forward from the last processed event
      // (order_by=asc + min_timestamp) instead means a slow-to-confirm
      // event just shows up on a later poll — nothing can silently drop.
      const tokenAddrBase58 = this.normalizeTronAddress(tokenAddr);

      if (this.lastTronEventTs[symbol] === undefined) {
        this.lastTronEventTs[symbol] = Date.now() - 10 * 60 * 1000;
      }

      try {
        const url = `${process.env.TRON_RPC}/v1/contracts/${tokenAddrBase58}/events`;
        const res = await axios.get(url, {
          params: {
            event_name:         'Transfer',
            only_confirmed:     true,
            min_block_timestamp: this.lastTronEventTs[symbol], // was min_timestamp — not a
                                                                 // real TronGrid param, so it
                                                                 // was silently ignored every
                                                                 // single poll, which is why
                                                                 // the same tx kept reappearing
            order_by:            'block_timestamp,asc',
            limit:                200,
          },
          headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
          timeout: 10000,
        });

        for (const evt of res.data?.data ?? []) {
          // Defensive: TronGrid names event params after whatever the
          // verified ABI declares. Our OZ-based ERC20 uses Transfer(from,
          // to, value) — but if ABI resolution ever falls back to a
          // generic TRC20 template, the community-standard interface
          // names them _from/_to/_value (underscore-prefixed) instead.
          // Handling both (plus positional array as a last resort) means
          // this doesn't silently break again if that fallback ever
          // kicks in — which is exactly what happened here (result.from/
          // .to/.value were all empty, meaning neither key was present as
          // the code assumed).
          const r = evt.result ?? {};
          const rawFrom  = r.from  ?? r._from  ?? (Array.isArray(r) ? r[0] : undefined);
          const rawTo    = r.to    ?? r._to    ?? (Array.isArray(r) ? r[1] : undefined);
          const rawValue = r.value ?? r._value ?? (Array.isArray(r) ? r[2] : undefined);

          if (!rawFrom || !rawTo) {
            this.logger.warn(`[tron] ${symbol} Transfer ${evt.transaction_id}: could not extract from/to — raw result: ${JSON.stringify(evt.result)}`);
            continue;
          }

          const from  = this.normalizeTronAddress(rawFrom);
          const to    = this.normalizeTronAddress(rawTo);
          const value = BigInt(rawValue ?? '0');
          this.logger.log(`[tron] ${symbol} Transfer ${evt.transaction_id}: ${from} → ${to} (${value})`);
          await this.handleTokenTransfer('tron', symbol, from, to, value, evt.transaction_id, evt.block ?? 0);

          if (evt.block_timestamp && evt.block_timestamp >= this.lastTronEventTs[symbol]) {
            this.lastTronEventTs[symbol] = evt.block_timestamp + 1;
          }
        }
      } catch (err: any) {
        this.logger.warn(`[tron] ${symbol} poll failed: ${err.response?.status ?? ''} ${err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message}`);
      }
    }
  }



  // ─── Polling-based listeners (TRON + fallback for chains without WSS) ─────────

  // Guards a startup network call so a prolonged outage can't hang
  // onModuleInit() (and therefore the whole app's readiness) indefinitely —
  // give up after a bounded wait and let the regular pollers catch up once
  // connectivity returns, same as everywhere else in this file.
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  private async initLastBlocks() {
    // TRON
    try {
      const tronWeb = new TronWeb({ fullHost: process.env.TRON_RPC! });
      const block   = await this.withTimeout(tronWeb.trx.getCurrentBlock(), 8000, 'TRON initial block fetch') as any;
      this.lastBlocks['tron'] = block.block_header.raw_data.number;
    } catch (err: any) {
      this.logger.warn(`Could not init TRON last block (starting from 0, will catch up via polling): ${err.message}`);
      this.lastBlocks['tron'] = 0;
    }

    // BSC (HTTP polling fallback — no WSS configured).
    // This used to construct its own bare `new ethers.JsonRpcProvider(...)`
    // instead of going through the shared getProvider() cache — meaning it
    // had no `staticNetwork` set, so on a DNS/network outage ethers fell
    // into its own built-in "failed to detect network, retry in 1s" loop,
    // spamming logs and (worse) potentially hanging onModuleInit() forever
    // since nothing bounded how long that internal retry could run. Routing
    // through getProvider() fixes the spam; withTimeout() below guarantees
    // startup can't hang even if something else fails to fail fast.
    try {
      const provider = this.getProvider('bsc');
      this.lastBlocks['bsc'] = await this.withTimeout(provider.getBlockNumber(), 8000, 'BSC initial block fetch');
    } catch (err: any) {
      this.logger.warn(`Could not init BSC last block (starting from 0, will catch up via polling): ${err.message}`);
      this.lastBlocks['bsc'] = 0;
    }
  }

  // ─── TRON polling — every 10 seconds ──────────────────────────────────────────

  @Cron('*/10 * * * * *') // every 10 seconds
  async pollTron() {
    const bridgeAddr = process.env.TRON_BRIDGE_V2_ADDRESS;
    if (!bridgeAddr) return;

    try {
      const tronWeb = new TronWeb({
        fullHost: process.env.TRON_RPC!,
        headers:  { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
      });

      const currentBlock = await tronWeb.trx.getCurrentBlock();
      const currentNum   = currentBlock.block_header.raw_data.number;
      const fromBlock    = this.lastBlocks['tron'] || currentNum - 20;

      if (currentNum <= fromBlock) return;

      // Get events from TronGrid event API
      const eventTypes = ['TokensLocked','TokensMinted','TokensBurned','TokensUnlocked'];
      for (const eventName of eventTypes) {
        try {
          const url = `${process.env.TRON_RPC}/v1/contracts/${bridgeAddr}/events?event_name=${eventName}&only_confirmed=true&limit=20`;
          const res = await axios.get(url, {
            headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
            timeout: 10000,
          });

          for (const evt of res.data?.data ?? []) {
            await this.handleTronEvent(eventName, evt);
          }
        } catch (err: any) {
          // Non-fatal — TronGrid event API may rate limit
        }
      }

      this.lastBlocks['tron'] = currentNum;
    } catch (err: any) {
      this.logger.error(`TRON polling error: ${err.message}`);
    }
  }

  private async handleTronEvent(eventName: string, evt: any) {
    const cacheKey = `tron:event:${evt.transaction_id}:${eventName}`;
    if (await this.redis.exists(cacheKey)) return; // already processed
    await this.redis.set(cacheKey, '1', 86400); // dedupe for 24h

    const result = evt.result ?? {};
    this.logger.log(`[tron] ${eventName}: ${JSON.stringify(result).slice(0,200)}`);

    if (eventName === 'TokensLocked') {
      const nonce = result.nonce;
      const transfer = await this.prisma.bridgeTransfer.findFirst({
        where: { srcChain:'tron', nonce: nonce?.toString(), status:{ in:['PENDING','LOCKED'] } },
      });
      if (transfer) {
        await this.prisma.bridgeTransfer.update({
          where: { id:transfer.id },
          data:  { status:'LOCKED', srcTxHash:evt.transaction_id },
        });
        await this.redis.publish('bridge:locked', JSON.stringify({ transferId:transfer.id, chain:'tron' }));
      }
    }

    if (eventName === 'TokensMinted' || eventName === 'TokensUnlocked') {
      const to = result.recipient || result.to;
      const transfer = await this.prisma.bridgeTransfer.findFirst({
        where: { dstChain:'tron', status:'LOCKED', dstAddress:to },
        orderBy: { createdAt:'desc' },
      });
      if (transfer) {
        await this.prisma.bridgeTransfer.update({
          where: { id:transfer.id },
          data:  { status:'COMPLETED', dstTxHash:evt.transaction_id },
        });
        await this.redis.publish('bridge:completed', JSON.stringify({ transferId:transfer.id, chain:'tron' }));
      }
    }
  }

  // ─── Watch incoming Transfer events for QR payment detection ──────────────────

  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollIncomingTransfers() {
    // For each chain with a configured token, check pending payments and
    // verify if a matching transfer has occurred to the merchant's settlement address.
    const pendingPayments = await this.prisma.paymentRequest.findMany({
      where: { status:'PENDING', expiresAt:{ gt:new Date() } },
      include: { merchant:true },
      take: 50,
    });

    if (pendingPayments.length === 0) return;

    for (const payment of pendingPayments) {
      try {
        const chain    = payment.merchant.settlementChain;
        const address  = payment.merchant.settlementAddress;
        const tokenAddr = this.getTokenAddress(chain, payment.token);
        if (!tokenAddr) continue;

        const matched = await this.checkRecentTransfer(chain, tokenAddr, address, payment.amount.toString());
        if (matched) {
          // Call payment-service to mark as paid
          await axios.post(
            `${process.env.PAYMENT_SERVICE_URL}/payments/${payment.id}/paid`,
            { txHash: matched.txHash, chain },
            { timeout: 5000 },
          ).catch(e => this.logger.warn(`Failed to notify payment-service: ${e.message}`));

          this.logger.log(`Payment ${payment.id} matched on-chain: ${matched.txHash}`);
        }
      } catch (err: any) {
        this.logger.error(`Payment check failed for ${payment.id}: ${err.message}`);
      }
    }
  }

  private async checkRecentTransfer(
    chain: string, tokenAddr: string, toAddress: string, expectedAmount: string,
  ): Promise<{ txHash: string } | null> {
    const cacheKey = `transfer:check:${chain}:${tokenAddr}:${toAddress}:${expectedAmount}`;
    // Rate limit checks per unique combination
    if (await this.redis.exists(cacheKey)) return null;

    if (chain === 'tron') {
      try {
        const url = `${process.env.TRON_RPC}/v1/accounts/${toAddress}/transactions/trc20?contract_address=${tokenAddr}&limit=10&only_to=true`;
        const res = await axios.get(url, {
          headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
          timeout: 10000,
        });
        for (const tx of res.data?.data ?? []) {
          const value = parseFloat(tx.value) / 1_000_000;
          if (Math.abs(value - parseFloat(expectedAmount)) < 0.000001) {
            await this.redis.set(cacheKey, '1', 300);
            return { txHash: tx.transaction_id };
          }
        }
      } catch {}
    } else {
      // EVM chains — check via provider logs
      try {
        const provider = this.getProvider(chain);
        const contract = new ethers.Contract(tokenAddr, ERC20_TRANSFER_ABI, provider);
        const block    = await provider.getBlockNumber();
        const filter   = contract.filters.Transfer(null, toAddress);
        const events   = await contract.queryFilter(filter, block - 100, block);

        for (const evt of events) {
          const e = evt as ethers.EventLog;
          const value = parseFloat(ethers.formatUnits(e.args.value, 6));
          if (Math.abs(value - parseFloat(expectedAmount)) < 0.000001) {
            await this.redis.set(cacheKey, '1', 300);
            return { txHash: e.transactionHash };
          }
        }
      } catch {}
    }
    return null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  // Chain IDs for the EVM testnets we support — passed explicitly to
  // JsonRpcProvider so it never issues its own `eth_chainId` auto-detect
  // call. Free/public RPC endpoints (Infura free tier, public BSC testnet
  // nodes) batch that detection call together with whatever real request
  // triggered it; when the endpoint then rate-limits or rejects part of
  // that batch, ethers can't cleanly split the mixed success/error array
  // and throws the confusing "missing response for request" BAD_DATA
  // error seen in the logs — even though only ONE of the batched calls
  // actually failed.
  

  private evmProviders: Record<string, ethers.JsonRpcProvider> = {};

  private getProvider(chain: string): ethers.JsonRpcProvider {
    if (this.evmProviders[chain]) return this.evmProviders[chain];

    const map: Record<string, string | undefined> = {
      ethereum: process.env.ETH_RPC,
      bsc:      process.env.BSC_RPC,
      polygon:  process.env.POLYGON_RPC,
    };
    const url = map[chain];
    if (!url) throw new Error(`No RPC configured for ${chain}`);

    const chainId = this.EVM_CHAIN_IDS[chain];
    const provider = new ethers.JsonRpcProvider(
      url,
      chainId ? ethers.Network.from(chainId) : undefined,
      {
        staticNetwork: chainId ? ethers.Network.from(chainId) : undefined,
        // Disable request batching — one JSON-RPC call per HTTP request.
        // Public/free-tier RPCs (Infura free tier, public BSC dataseed)
        // rate-limit or outright reject batched arrays of calls; sending
        // requests one at a time avoids the "Too Many Requests" /
        // "triggered rate limit" errors entirely.
        batchMaxCount: 1,
      },
    );
    this.evmProviders[chain] = provider;
    return provider;
  }

  private normalizeTronAddress(address?: string): string {
    if (!address) return '';
    try {
      // TronGrid's contract-events API can return addresses in raw hex form
      // (with or without the "41" TRON prefix) instead of base58. Our
      // Wallet.address column always stores TRON addresses in base58 (T...),
      // so normalize before comparing/storing, or the wallet lookup silently
      // matches nothing and both the confirm and the receive-record steps fail.
      if (address.startsWith('T')) return address; // already base58
      const hex = address.startsWith('0x') ? address.slice(2) : address;
      const withPrefix = hex.startsWith('41') ? hex : `41${hex}`;
      return TronWeb.address.fromHex(withPrefix);
    } catch (err: any) {
      this.logger.warn(`Could not normalize TRON address "${address}": ${err.message}`);
      return address;
    }
  }

  private getTokenAddress(chain: string, symbol: string): string | undefined {
    const map: Record<string,Record<string,string|undefined>> = {
      tron:     { INRX:process.env.TRON_INRX_ADDRESS,  EGOLD:process.env.TRON_EGOLD_ADDRESS,  ESLVR:process.env.TRON_ESLVR_ADDRESS },
      ethereum: { INRX:process.env.ETH_INRX_ADDRESS, EGOLD:process.env.ETH_EGOLD_ADDRESS, ESLVR:process.env.ETH_ESLVR_ADDRESS },
      bsc:      { INRX:process.env.BSC_INRX_ADDRESS,    EGOLD:process.env.BSC_EGOLD_ADDRESS,    ESLVR:process.env.BSC_ESLVR_ADDRESS },
      polygon:  { INRX:process.env.POLYGON_INRX_ADDRESS, EGOLD:process.env.POLYGON_EGOLD_ADDRESS, ESLVR:process.env.POLYGON_ESLVR_ADDRESS },
    };
    return map[chain]?.[symbol];
  }
}