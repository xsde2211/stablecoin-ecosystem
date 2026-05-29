import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ethers }        from "ethers";
import { TronWeb }       from "tronweb";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService }  from "../redis/redis.service";

const EVENTS_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event TokensLocked(address indexed from, uint256 amount, uint256 dstChainId, uint256 nonce)",
  "event TokensMinted(address indexed to, uint256 amount, uint256 srcChainId, bytes32 nonce)",
  "event OperationExecuted(uint256 indexed opId)",
];

interface ChainConfig {
  name:    string;
  rpc:     string;
  wsRpc?:  string;
  tokens:  string[];
  bridge:  string;
}

@Injectable()
export class ListenerService implements OnModuleInit {
  private readonly logger = new Logger(ListenerService.name);
  private providers: Map<string, ethers.WebSocketProvider> = new Map();

  constructor(
    private prisma: PrismaService,
    private redis:  RedisService,
  ) {}

  async onModuleInit() {
    this.logger.log("Starting blockchain event listeners...");
    await this.startEVMListeners();
    this.logger.log("TRON polling active (via @Cron)");
  }

  // ─── EVM WebSocket listeners ──────────────────────────────────────────────

  private async startEVMListeners() {
    const chains: ChainConfig[] = [
      {
        name:   "ethereum",
        rpc:    process.env.ETH_RPC!,
        tokens: [
          process.env.ETH_INRX_ADDRESS!,
          process.env.ETH_EGOLD_ADDRESS!,
          process.env.ETH_ESLVR_ADDRESS!,
        ].filter(Boolean),
        bridge: process.env.ETH_BRIDGE_ADDRESS!,
      },
      {
        name:   "bsc",
        rpc:    process.env.BSC_RPC!,
        tokens: [
          process.env.BSC_INRX_ADDRESS!,
          process.env.BSC_EGOLD_ADDRESS!,
          process.env.BSC_ESLVR_ADDRESS!,
        ].filter(Boolean),
        bridge: process.env.BSC_BRIDGE_ADDRESS!,
      },
      {
        name:   "polygon",
        rpc:    process.env.POLYGON_RPC!,
        tokens: [
          process.env.POLYGON_INRX_ADDRESS!,
          process.env.POLYGON_EGOLD_ADDRESS!,
          process.env.POLYGON_ESLVR_ADDRESS!,
        ].filter(Boolean),
        bridge: process.env.POLYGON_BRIDGE_ADDRESS!,
      },
    ];

    for (const chain of chains) {
      try {
        await this.listenEVM(chain);
      } catch (err) {
        this.logger.error(`Failed to start listener for ${chain.name}:`, err);
      }
    }
  }

  private async listenEVM(chain: ChainConfig) {
    // Use ws:// for WebSocket — convert https:// to wss://
    const wsUrl = chain.rpc
      .replace("https://", "wss://")
      .replace("http://",  "ws://");

    let provider: ethers.WebSocketProvider;
    try {
      provider = new ethers.WebSocketProvider(wsUrl);
    } catch {
      // Fallback: use polling provider if WS not supported
      this.logger.warn(`WS not available for ${chain.name}, using polling`);
      return this.startPolling(chain);
    }

    this.providers.set(chain.name, provider);

    // Listen on each token contract
    for (const tokenAddr of chain.tokens) {
      if (!tokenAddr) continue;
      const contract = new ethers.Contract(tokenAddr, EVENTS_ABI, provider);

      contract.on("Transfer", async (from, to, value, event) => {
        await this.handleEVMTransfer({
          chain:   chain.name,
          from,
          to,
          value,
          txHash:  event.log.transactionHash,
          address: tokenAddr,
        });
      });
    }

    // Listen on bridge contract
    if (chain.bridge) {
      const bridge = new ethers.Contract(chain.bridge, EVENTS_ABI, provider);

      bridge.on("TokensLocked", async (from, amount, dstChainId, nonce, event) => {
        await this.handleLockEvent({
          chain:      chain.name,
          from,
          amount,
          dstChainId: dstChainId.toString(),
          nonce:      nonce.toString(),
          txHash:     event.log.transactionHash,
        });
      });

      bridge.on("TokensMinted", async (to, amount, srcChainId, nonce, event) => {
        await this.handleMintEvent({
          chain:     chain.name,
          to,
          amount,
          srcChainId: srcChainId.toString(),
          nonce:      nonce.toString(),
          txHash:     event.log.transactionHash,
        });
      });
    }

    // Handle disconnects — reconnect after 5s
    provider.websocket.addEventListener("close", () => {
      this.logger.warn(`WebSocket closed for ${chain.name}, reconnecting in 5s...`);
      this.providers.delete(chain.name);
      setTimeout(() => this.listenEVM(chain), 5000);
    });

    this.logger.log(`Listening on ${chain.name} (${chain.tokens.length} tokens + bridge)`);
  }

  // Polling fallback for chains that don't support WebSocket
  private async startPolling(chain: ChainConfig) {
    const provider  = new ethers.JsonRpcProvider(chain.rpc);
    let lastBlock   = await provider.getBlockNumber();

    setInterval(async () => {
      try {
        const current = await provider.getBlockNumber();
        if (current <= lastBlock) return;

        for (const tokenAddr of chain.tokens) {
          if (!tokenAddr) continue;
          const contract = new ethers.Contract(tokenAddr, EVENTS_ABI, provider);
          const filter   = contract.filters.Transfer();
          const events   = await contract.queryFilter(filter, lastBlock + 1, current);

          for (const event of events) {
            if (!("args" in event)) continue;
            await this.handleEVMTransfer({
              chain:   chain.name,
              from:    event.args[0],
              to:      event.args[1],
              value:   event.args[2],
              txHash:  event.transactionHash,
              address: tokenAddr,
            });
          }
        }

        lastBlock = current;
      } catch (err) {
        this.logger.error(`Polling error on ${chain.name}:`, err);
      }
    }, 15_000); // every 15 seconds

    this.logger.log(`Polling started for ${chain.name} every 15s`);
  }

  // ─── TRON polling (no WebSocket standard) ────────────────────────────────

  @Cron("*/3 * * * * *") // every 3 seconds
  async pollTRON() {
    try {
      const bridgeAddress = process.env.TRON_BRIDGE_ADDRESS;
      if (!bridgeAddress) return;

      const tronWeb = new TronWeb({ fullHost: process.env.TRON_RPC! });

      // Get last processed fingerprint from Redis
      const lastFingerprint = await this.redis.get("tron:last_fingerprint:lock");

      const events = await tronWeb.getEventResult(bridgeAddress, {
        eventName:   "TokensLocked",
        size:        20,
        fingerprint: lastFingerprint ?? undefined,
      });

      if (!events?.length) return;

      for (const event of events) {
        const alreadyProcessed = await this.redis.exists(`tron:event:${event.transaction}`);
        if (alreadyProcessed) continue;

        await this.handleTRONLockEvent(event);
        await this.redis.set(`tron:event:${event.transaction}`, "1", 86_400);
      }

      // Store last fingerprint for pagination
      if (events.length > 0) {
        await this.redis.set("tron:last_fingerprint:lock", events[events.length - 1].fingerprint ?? "", 3600);
      }
    } catch (err) {
      this.logger.error("TRON polling error:", err);
    }
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private async handleEVMTransfer(data: {
    chain:   string;
    from:    string;
    to:      string;
    value:   bigint;
    txHash:  string;
    address: string;
  }) {
    // Update any pending transaction with this hash to CONFIRMED
    const updated = await this.prisma.transaction.updateMany({
      where: { txHash: data.txHash },
      data:  { status: "CONFIRMED", confirmedAt: new Date() },
    });

    if (updated.count > 0) {
      this.logger.log(`Confirmed tx ${data.txHash} on ${data.chain}`);
    } else {
      // It's an incoming transfer — create a receive record if we know the wallet
      const wallet = await this.prisma.wallet.findFirst({
        where: { address: data.to, chain: data.chain },
      });
      if (wallet) {
        await this.prisma.transaction.create({
          data: {
            walletId:    wallet.id,
            txHash:      data.txHash,
            chain:       data.chain,
            type:        "RECEIVE",
            amount:      ethers.formatUnits(data.value, 6),
            tokenSymbol: "INRX", // TODO: look up by contract address
            fromAddress: data.from,
            toAddress:   data.to,
            status:      "CONFIRMED",
            confirmedAt: new Date(),
          },
        });
        this.logger.log(`Incoming transfer recorded for wallet ${wallet.id}`);
      }
    }
  }

  private async handleLockEvent(data: {
    chain:      string;
    from:       string;
    amount:     bigint;
    dstChainId: string;
    nonce:      string;
    txHash:     string;
  }) {
    // Update bridge transfer status to LOCKED
    await this.prisma.bridgeTransfer.updateMany({
      where: { srcTxHash: data.txHash },
      data:  { status: "LOCKED", confirmations: 1 },
    });

    // Cache lock event for validator service to pick up
    await this.redis.set(
      `bridge:lock:${data.txHash}`,
      JSON.stringify({ ...data, detectedAt: new Date().toISOString() }),
      3600,
    );

    this.logger.log(`Lock event on ${data.chain}: ${data.txHash} nonce=${data.nonce}`);
  }

  private async handleMintEvent(data: {
    chain:     string;
    to:        string;
    amount:    bigint;
    srcChainId: string;
    nonce:     string;
    txHash:    string;
  }) {
    await this.prisma.bridgeTransfer.updateMany({
      where: { dstTxHash: data.txHash },
      data:  { status: "COMPLETED" },
    });

    this.logger.log(`Mint event on ${data.chain}: ${data.txHash}`);
  }

  private async handleTRONLockEvent(event: any) {
    const txId = event.transaction;
    this.logger.log(`TRON lock event: ${txId}`);

    await this.prisma.bridgeTransfer.updateMany({
      where: { srcTxHash: txId },
      data:  { status: "LOCKED", confirmations: 1 },
    });

    await this.redis.set(
      `bridge:lock:${txId}`,
      JSON.stringify({
        chain:      "tron",
        txHash:     txId,
        from:       event.result?.sender,
        amount:     event.result?.amount,
        dstChain:   event.result?.dstChain,
        nonce:      event.result?.nonce,
        detectedAt: new Date().toISOString(),
      }),
      3600,
    );
  }
}
