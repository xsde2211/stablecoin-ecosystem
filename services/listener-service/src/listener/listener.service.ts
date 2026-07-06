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

    // Watch plain token Transfer events (wallet sends/receives) on chains with WSS
    await this.setupTokenTransferListeners();

    // Initialize last-block tracking for polling-based chains (TRON, fallback EVM)
    await this.initLastBlocks();

    this.logger.log('Listener service ready');
  }

  // ─── WebSocket listeners (real-time, for chains with WSS RPC) ────────────────

  private async setupEVMWebsocketListeners() {
    const wsConfigs = [
      { chain:'ethereum', wsUrl: process.env.ETH_WS_RPC,     bridgeAddr: process.env.ETH_BRIDGE_V2_ADDRESS },
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

  // ─── WebSocket listeners for plain token Transfer events (wallet send/receive) ─

  private async setupTokenTransferListeners() {
    const TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;
    const wsConfigs = [
      { chain: 'ethereum', wsUrl: process.env.ETH_WS_RPC },
      { chain: 'polygon',  wsUrl: process.env.POLYGON_WS_RPC },
    ];

    for (const cfg of wsConfigs) {
      if (!cfg.wsUrl) {
        this.logger.warn(`Skipping token WS listener for ${cfg.chain} — missing WS RPC`);
        continue;
      }

      try {
        const provider = new ethers.WebSocketProvider(cfg.wsUrl);

        for (const symbol of TOKENS) {
          const tokenAddr = this.getTokenAddress(cfg.chain, symbol);
          if (!tokenAddr) {
            this.logger.warn(`Skipping ${cfg.chain}/${symbol} token listener — address not configured`);
            continue;
          }

          const contract = new ethers.Contract(tokenAddr, ERC20_TRANSFER_ABI, provider);
          contract.on('Transfer', (from: string, to: string, value: bigint, event: any) => {
            const txHash      = event?.log?.transactionHash ?? event?.transactionHash;
            const blockNumber = event?.log?.blockNumber ?? event?.blockNumber ?? 0;
            this.handleTokenTransfer(cfg.chain, symbol, from, to, value, txHash, blockNumber)
              .catch(err => this.logger.error(`handleTokenTransfer error [${cfg.chain}/${symbol}]: ${err.message}`));
          });

          this.logger.log(`Token WS listener active for ${cfg.chain}/${symbol}: ${tokenAddr}`);
        }
      } catch (err: any) {
        this.logger.error(`Failed to set up token WS listener for ${cfg.chain}: ${err.message}`);
      }
    }
  }

// ─── Shared handler — confirms sends, records receives, for any chain/token ───

  private async handleTokenTransfer(
    chain: string, symbol: string, from: string, to: string,
    value: bigint, txHash: string, blockNumber: number,
  ) {
    if (!txHash) return;

    const cacheKey = `token:transfer:${chain}:${txHash}:${symbol}`;
    if (await this.redis.exists(cacheKey)) return;
    await this.redis.set(cacheKey, '1', 86400);

    const amount = ethers.formatUnits(value, 6);

    // Normalize addresses — EVM addresses to lowercase, TRON stays base58
    const fromNorm = chain === 'tron' ? this.normalizeTronAddress(from) : from.toLowerCase();
    const toNorm   = chain === 'tron' ? this.normalizeTronAddress(to)   : to.toLowerCase();

    // Side 1 — confirm the PENDING SEND row for the sender
    // Match by txHash + status PENDING (the row was created by wallet.service sendToken)
    const updated = await this.prisma.transaction.updateMany({
      where: { txHash, status: 'PENDING' },
      data:  { status: 'CONFIRMED', confirmedAt: new Date(), blockNumber: BigInt(blockNumber) },
    });
    if (updated.count > 0) {
      this.logger.log(`[${chain}] Confirmed ${symbol} SEND tx ${txHash} (${amount})`);
    }

    // Side 2 — create RECEIVE row for the recipient wallet if it belongs to a user
    // Use case-insensitive address match (mode: 'insensitive') for EVM chains
    const wallet = chain === 'tron'
      ? await this.prisma.wallet.findFirst({ where: { address: toNorm, chain } })
      : await this.prisma.wallet.findFirst({
          where: {
            address: { equals: toNorm, mode: 'insensitive' },
            chain,
          },
        });

    if (!wallet) return; // recipient is not one of our users — nothing to record

    try {
      await this.prisma.transaction.create({
        data: {
          walletId:    wallet.id,
          txHash,
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
      });
      this.logger.log(`[${chain}] Recorded RECEIVE ${symbol} ${txHash} → wallet ${wallet.id} (user ${wallet.userId})`);
    } catch (err: any) {
      // @@unique([walletId, txHash]) — duplicate event delivery hits this; safe to ignore
      if (!err.message?.includes('Unique constraint')) {
        this.logger.error(`Failed to record RECEIVE ${txHash}: ${err.message}`);
      }
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

  @Cron('*/60 * * * * *') // every 60 seconds
  async pollEvmTokenTransfersAll() {
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
        await this.pollEvmTokenTransfers(chain, rpcUrl);
      } catch (err: any) {
        this.logger.error(`${chain} token polling error: ${err.message}`);
      }
    }
  }

  private async pollEvmTokenTransfers(chain: string, rpcUrl: string) {
    if (!rpcUrl) return;
    const TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const currentBlock = await provider.getBlockNumber();
    const key          = `${chain}_tokens`;
    const fromBlock    = this.lastBlocks[key] ?? currentBlock - 20;
    if (currentBlock <= fromBlock) return;

    for (const symbol of TOKENS) {
      const tokenAddr = this.getTokenAddress(chain, symbol);
      if (!tokenAddr) {
        this.logger.warn(`Skipping ${chain}/${symbol} poll — token address not configured`);
        continue;
      }

      try {
        const contract = new ethers.Contract(tokenAddr, ERC20_TRANSFER_ABI, provider);
        const events   = await contract.queryFilter(contract.filters.Transfer(), fromBlock + 1, currentBlock);

        if (events.length > 0) {
          this.logger.debug(`[${chain}] Found ${events.length} ${symbol} Transfer event(s) in blocks ${fromBlock + 1}-${currentBlock}`);
        }

        for (const evt of events) {
          const e = evt as ethers.EventLog;
          this.logger.debug(`[${chain}] ${symbol} Transfer ${e.transactionHash}: ${e.args.from} → ${e.args.to} (${e.args.value})`);
          await this.handleTokenTransfer(
            chain, symbol, e.args.from, e.args.to, e.args.value, e.transactionHash, e.blockNumber,
          );
        }
      } catch (err: any) {
        this.logger.warn(`Token poll failed [${chain}/${symbol}]: ${err.message}`);
      }
    }

    this.lastBlocks[key] = currentBlock;
  }

  // ─── Polling fallback — TRON (no native WSS event subscriptions) ──────────────

  @Cron('*/30 * * * * *') // every 30 seconds
  async pollTronTokenTransfers() {
    const TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;

    for (const symbol of TOKENS) {
      const tokenAddr = this.getTokenAddress('tron', symbol);
      if (!tokenAddr) continue;

      try {
        const url = `${process.env.TRON_RPC}/v1/contracts/${tokenAddr}/events?event_name=Transfer&only_confirmed=true&limit=20`;
        const res = await axios.get(url, {
          headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
          timeout: 10000,
        });

        for (const evt of res.data?.data ?? []) {
          const from  = this.normalizeTronAddress(evt.result?.from);
          const to    = this.normalizeTronAddress(evt.result?.to);
          const value = BigInt(evt.result?.value ?? '0');
          this.logger.debug(`[tron] ${symbol} Transfer ${evt.transaction_id}: ${from} → ${to} (${value})`);
          await this.handleTokenTransfer('tron', symbol, from, to, value, evt.transaction_id, evt.block ?? 0);
        }
      } catch (err: any) {
        // Non-fatal — TronGrid event API may rate limit
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