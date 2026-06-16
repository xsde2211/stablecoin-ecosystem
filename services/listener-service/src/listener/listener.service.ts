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
  '728126428': 'tron',
};

@Injectable()
export class ListenerService implements OnModuleInit {
  private readonly logger = new Logger(ListenerService.name);

  // Track last processed block per chain to avoid re-scanning
  private lastBlocks: Record<string, number> = {};

  constructor(
    private prisma: PrismaService,
    private redis:  RedisService,
  ) {}

  async onModuleInit() {
    this.logger.log('Listener service initializing — setting up WebSocket subscriptions');

    // Set up real-time WebSocket listeners for EVM chains (where WSS available)
    await this.setupEVMWebsocketListeners();

    // Initialize last-block tracking for polling-based chains (TRON, fallback EVM)
    await this.initLastBlocks();

    this.logger.log('Listener service ready');
  }

  // ─── WebSocket listeners (real-time, for chains with WSS RPC) ────────────────

  private async setupEVMWebsocketListeners() {
    const wsConfigs = [
      { chain:'ethereum', wsUrl: process.env.ETH_WS_RPC,     bridgeAddr: process.env.SEPOLIA_BRIDGE_V2_ADDRESS },
      { chain:'polygon',  wsUrl: process.env.POLYGON_WS_RPC, bridgeAddr: process.env.POLYGONAMOY_BRIDGE_V2_ADDRESS },
    ];

    for (const cfg of wsConfigs) {
      if (!cfg.wsUrl || !cfg.bridgeAddr) {
        this.logger.warn(`Skipping WS listener for ${cfg.chain} — missing WS RPC or bridge address`);
        continue;
      }

      try {
        const provider = new ethers.WebSocketProvider(cfg.wsUrl);
        const bridge   = new ethers.Contract(cfg.bridgeAddr, BRIDGE_V2_ABI, provider);

        bridge.on('TokensLocked', (...args) => this.handleLockEvent(cfg.chain, args));
        bridge.on('TokensMinted', (...args) => this.handleMintEvent(cfg.chain, args));
        bridge.on('TokensBurned', (...args) => this.handleBurnEvent(cfg.chain, args));
        bridge.on('TokensUnlocked', (...args) => this.handleUnlockEvent(cfg.chain, args));

        this.logger.log(`WebSocket listener active for ${cfg.chain} bridge: ${cfg.bridgeAddr}`);
      } catch (err: any) {
        this.logger.error(`Failed to set up WS listener for ${cfg.chain}: ${err.message}`);
      }
    }
  }

  // ─── Event Handlers — Bridge events ───────────────────────────────────────────

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
      await this.prisma.bridgeTransfer.update({
        where: { id: transfer.id },
        data:  { status:'LOCKED', srcTxHash: event?.log?.transactionHash ?? event?.transactionHash },
      });
      this.logger.log(`Bridge transfer ${transfer.id} confirmed LOCKED on ${chain}`);

      // Notify bridge-service to proceed with relayer mint via Redis pub/sub
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
        data:  { status:'LOCKED', srcTxHash: event?.log?.transactionHash ?? event?.transactionHash },
      });
      await this.redis.publish('bridge:burned', JSON.stringify({
        transferId: transfer.id, chain, symbol, amount: ethers.formatUnits(amount,6),
      }));
    }
  }

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

  // ─── Polling-based listeners (TRON + fallback for chains without WSS) ─────────

  private async initLastBlocks() {
    // TRON
    try {
      const tronWeb = new TronWeb({ fullHost: process.env.TRON_RPC! });
      const block   = await tronWeb.trx.getCurrentBlock();
      this.lastBlocks['tron'] = block.block_header.raw_data.number;
    } catch (err: any) {
      this.logger.warn(`Could not init TRON last block: ${err.message}`);
      this.lastBlocks['tron'] = 0;
    }

    // BSC (HTTP polling fallback — no WSS configured)
    try {
      const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC!);
      this.lastBlocks['bsc'] = await provider.getBlockNumber();
    } catch (err: any) {
      this.logger.warn(`Could not init BSC last block: ${err.message}`);
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

  private getProvider(chain: string): ethers.JsonRpcProvider {
    const map: Record<string,string> = {
      ethereum: process.env.ETH_RPC!,
      bsc:      process.env.BSC_RPC!,
      polygon:  process.env.POLYGON_RPC!,
    };
    return new ethers.JsonRpcProvider(map[chain]);
  }

  private getTokenAddress(chain: string, symbol: string): string | undefined {
    const map: Record<string,Record<string,string|undefined>> = {
      tron:     { INRX:process.env.TRON_INRX_ADDRESS,  EGOLD:process.env.TRON_EGOLD_ADDRESS,  ESLVR:process.env.TRON_ESLVR_ADDRESS },
      ethereum: { INRX:process.env.SEPOLIA_INRX_ADDRESS, EGOLD:process.env.SEPOLIA_EGOLD_ADDRESS, ESLVR:process.env.SEPOLIA_ESLVR_ADDRESS },
      bsc:      { INRX:process.env.BSC_INRX_ADDRESS,    EGOLD:process.env.BSC_EGOLD_ADDRESS,    ESLVR:process.env.BSC_ESLVR_ADDRESS },
      polygon:  { INRX:process.env.POLYGONAMOY_INRX_ADDRESS, EGOLD:process.env.POLYGONAMOY_EGOLD_ADDRESS, ESLVR:process.env.POLYGONAMOY_ESLVR_ADDRESS },
    };
    return map[chain]?.[symbol];
  }
}
