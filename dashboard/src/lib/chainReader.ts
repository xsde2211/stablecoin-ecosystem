import { ethers } from 'ethers';
import { ChainConfig, ERC20_ABI, TRC20_ABI } from './constants';

export interface TokenBalances {
  INRX: number;
  EGOLD: number;
  ESLVR: number;
}

export interface TokenHolder {
  address: string;
  balance: number;
}

export interface TokenHolderData {
  holders: TokenHolder[]; // sorted by balance, descending
  holderCount: number;
  totalHeld: number; // == total minted currently in circulation
}

export interface ChainHolderData {
  INRX: TokenHolderData;
  EGOLD: TokenHolderData;
  ESLVR: TokenHolderData;
}

// ─── API keys ────────────────────────────────────────────────────────────────

const ETHERSCAN_API_KEY = import.meta.env.VITE_ETHERSCAN_API_KEY || '';
const TRONSCAN_API_KEY = import.meta.env.VITE_TRONSCAN_API_KEY || '';

// Etherscan V2 supported EVM chain IDs used by this application.
const ETHERSCAN_CHAIN_IDS: Record<string, number> = {
  ethereum: 11155111, // Sepolia
  polygon: 80002,     // Polygon Amoy
  bsc: 97,            // BSC Testnet
};

// ─── Providers / clients with automatic multi-RPC failover ──────────────────

const EVM_RPC_CANDIDATES: Record<string, string[]> = {
  ethereum: [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://rpc.sepolia.org',
    'https://sepolia.drpc.org',
    'https://1rpc.io/sepolia',
  ],

  polygon: [
    'https://polygon-amoy-bor-rpc.publicnode.com',
    'https://rpc.ankr.com/polygon_amoy',
    'https://polygon-amoy.drpc.org',
    'https://polygon-amoy.gateway.tenderly.co',
  ],

  // BSC Testnet:
  // Put PublicNode first because it is the configured/default RPC
  // and has been more reliable for historical eth_getLogs requests.
  bsc: [
    'https://bsc-testnet-rpc.publicnode.com',
    'https://bsc-prebsc-dataseed.bnbchain.org',
    'https://bsc-testnet.bnbchain.org',
    'https://rpc.ankr.com/bsc_testnet_chapel',
  ],
};

function candidateUrls(chain: ChainConfig): string[] {
  return Array.from(
    new Set([
      chain.rpc,
      ...(EVM_RPC_CANDIDATES[chain.id] ?? []),
    ])
  );
}

const PER_RPC_TIMEOUT_MS = 12_000;

function buildProvider(
  url: string,
  chainId: number
): ethers.JsonRpcProvider {
  const fetchRequest = new ethers.FetchRequest(url);
  fetchRequest.timeout = PER_RPC_TIMEOUT_MS;

  return new ethers.JsonRpcProvider(
    fetchRequest,
    ethers.Network.from(chainId),
    {
      batchMaxCount: 1,
      staticNetwork: true,
    }
  );
}

interface LiveProvider {
  provider: ethers.JsonRpcProvider;
  index: number;
  url: string;
}

const evmProviders = new Map<string, LiveProvider>();

async function failoverToNextProvider(
  chain: ChainConfig,
  afterIndex: number
): Promise<ethers.JsonRpcProvider> {
  const urls = candidateUrls(chain);
  const chainId = ETHERSCAN_CHAIN_IDS[chain.id];

  for (let i = afterIndex + 1; i < urls.length; i++) {
    const url = urls[i];
    const provider = buildProvider(url, chainId);

    try {
      await provider.getBlockNumber();

      console.info(
        `[${chain.id}] using RPC #${i}: ${url}`
      );

      evmProviders.set(chain.id, {
        provider,
        index: i,
        url,
      });

      return provider;
    } catch (err: any) {
      console.warn(
        `[${chain.id}] RPC #${i} (${url}) unreachable: ${
          err?.shortMessage ?? err?.message ?? err
        } — trying next`
      );
    }
  }

  throw new Error(
    `[${chain.id}] all ${urls.length} RPC endpoints failed`
  );
}

async function getEvmProvider(
  chain: ChainConfig
): Promise<ethers.JsonRpcProvider> {
  const cached = evmProviders.get(chain.id);

  if (cached) {
    return cached.provider;
  }

  return coalescedFailover(chain, -1);
}

// Coalesce concurrent failover attempts so INRX/EGOLD/ESLVR do not
// simultaneously probe every RPC when the shared provider fails.
const failoverInFlight = new Map<
  string,
  Promise<ethers.JsonRpcProvider>
>();

function coalescedFailover(
  chain: ChainConfig,
  afterIndex: number
): Promise<ethers.JsonRpcProvider> {
  const existing = failoverInFlight.get(chain.id);

  if (existing) {
    return existing;
  }

  const attempt = failoverToNextProvider(
    chain,
    afterIndex
  ).finally(() => {
    failoverInFlight.delete(chain.id);
  });

  failoverInFlight.set(chain.id, attempt);

  return attempt;
}

// Avoid immediately hammering every RPC again after all providers failed.
const allFailedUntil = new Map<string, number>();
const ALL_FAILED_COOLDOWN_MS = 15_000;

async function withEvmFailover<T>(
  chain: ChainConfig,
  fn: (
    provider: ethers.JsonRpcProvider
  ) => Promise<T>
): Promise<T> {
  const coolingDown = allFailedUntil.get(chain.id);

  if (
    coolingDown &&
    Date.now() < coolingDown
  ) {
    throw new Error(
      `[${chain.id}] all RPC endpoints recently failed — cooling down for ${Math.ceil(
        (coolingDown - Date.now()) / 1000
      )}s before retrying`
    );
  }

  const provider = await getEvmProvider(chain);

  try {
    return await fn(provider);
  } catch (err: any) {
    const failedIndex =
      evmProviders.get(chain.id)?.index ?? -1;

    console.warn(
      `[${chain.id}] RPC call failed (${
        err?.shortMessage ?? err?.message ?? err
      }) — failing over to next RPC`
    );

    evmProviders.delete(chain.id);

    try {
      const nextProvider = await coalescedFailover(
        chain,
        failedIndex
      );

      return await fn(nextProvider);
    } catch (failoverErr) {
      allFailedUntil.set(
        chain.id,
        Date.now() + ALL_FAILED_COOLDOWN_MS
      );

      throw failoverErr;
    }
  }
}

// ─── TRON client ─────────────────────────────────────────────────────────────

let tronWebModulePromise:
  Promise<typeof import('tronweb')> | null = null;

function loadTronWeb() {
  if (!tronWebModulePromise) {
    tronWebModulePromise = import('tronweb');
  }

  return tronWebModulePromise;
}

const tronClients = new Map<string, any>();

async function getTronClient(chain: ChainConfig) {
  let client = tronClients.get(chain.id);

  if (!client) {
    const { TronWeb } = await loadTronWeb();

    client = new TronWeb({
      fullHost: chain.rpc,
    });

    // Read-only calls still need an owner/calling context.
    client.setAddress(chain.tokens.INRX);

    tronClients.set(chain.id, client);
  }

  return client;
}

// ─── Legacy single-address balance ───────────────────────────────────────────

async function readEvmTokenBalance(
  chain: ChainConfig,
  tokenAddress: string,
  holderAddress: string
): Promise<number> {
  if (!holderAddress) return 0;

  return withEvmFailover(
    chain,
    async (provider) => {
      const contract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        provider
      );

      const [raw, decimals] = await Promise.all([
        contract.balanceOf(holderAddress),
        contract.decimals().catch(() => 18),
      ]);

      return Number(
        ethers.formatUnits(raw, decimals)
      );
    }
  );
}

async function readEvmBalances(
  chain: ChainConfig
): Promise<TokenBalances> {
  const [INRX, EGOLD, ESLVR] =
    await Promise.all([
      readEvmTokenBalance(
        chain,
        chain.tokens.INRX,
        chain.bridge
      ),
      readEvmTokenBalance(
        chain,
        chain.tokens.EGOLD,
        chain.bridge
      ),
      readEvmTokenBalance(
        chain,
        chain.tokens.ESLVR,
        chain.bridge
      ),
    ]);

  return {
    INRX,
    EGOLD,
    ESLVR,
  };
}

async function readTronTokenBalance(
  tronWeb: any,
  tokenAddress: string,
  holderAddress: string
): Promise<number> {
  if (!holderAddress) return 0;

  const contract = tronWeb.contract(
    TRC20_ABI,
    tokenAddress
  );

  const [raw, decimals] =
    await Promise.all([
      contract.balanceOf(holderAddress).call(),
      contract.decimals().call().catch(() => 18),
    ]);

  return Number(
    ethers.formatUnits(
      raw.toString(),
      Number(decimals)
    )
  );
}

async function readTronBalances(
  chain: ChainConfig
): Promise<TokenBalances> {
  const tronWeb = await getTronClient(chain);

  const [INRX, EGOLD, ESLVR] =
    await Promise.all([
      readTronTokenBalance(
        tronWeb,
        chain.tokens.INRX,
        chain.bridge
      ),
      readTronTokenBalance(
        tronWeb,
        chain.tokens.EGOLD,
        chain.bridge
      ),
      readTronTokenBalance(
        tronWeb,
        chain.tokens.ESLVR,
        chain.bridge
      ),
    ]);

  return {
    INRX,
    EGOLD,
    ESLVR,
  };
}

export async function readContractBalances(
  chain: ChainConfig
): Promise<TokenBalances> {
  return chain.kind === 'tron'
    ? readTronBalances(chain)
    : readEvmBalances(chain);
}

// ─── Holder enumeration ──────────────────────────────────────────────────────

const TRANSFER_TOPIC0 = ethers.id(
  'Transfer(address,address,uint256)'
);

const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000';

function applyTransferDeltas(
  balances: Map<string, bigint>,
  from: string,
  to: string,
  value: bigint
) {
  if (from.toLowerCase() !== ZERO_ADDRESS) {
    balances.set(
      from,
      (balances.get(from) ?? 0n) - value
    );
  }

  if (to.toLowerCase() !== ZERO_ADDRESS) {
    balances.set(
      to,
      (balances.get(to) ?? 0n) + value
    );
  }
}

function toHolderData(
  balances: Map<string, bigint>,
  decimals: number
): TokenHolderData {
  const holders: TokenHolder[] = [];
  let totalHeld = 0;

  for (const [address, raw] of balances) {
    if (raw <= 0n) continue;

    const balance = Number(
      ethers.formatUnits(raw, decimals)
    );

    holders.push({
      address,
      balance,
    });

    totalHeld += balance;
  }

  holders.sort(
    (a, b) => b.balance - a.balance
  );

  return {
    holders,
    holderCount: holders.length,
    totalHeld,
  };
}

// ─── Holder cache ─────────────────────────────────────────────────────────────

interface HolderCache {
  balances: Map<string, bigint>;
  lastScannedBlock: number;
}

const holderCaches = new Map<
  string,
  HolderCache
>();

// ─── Etherscan log fetching ──────────────────────────────────────────────────
//
// Etherscan is still used for Ethereum and Polygon.
// BSC Testnet intentionally DOES NOT use Etherscan because its free
// API access currently rejects chainid=97.
//
// BSC therefore goes directly through the RPC log scanner below.

interface RawLog {
  topics: string[];
  data: string;
  blockNumber: number;
}

async function fetchLogsViaEtherscan(
  chain: ChainConfig,
  tokenAddress: string,
  fromBlock: number
): Promise<RawLog[] | null> {
  const chainId =
    ETHERSCAN_CHAIN_IDS[chain.id];

  if (
    !ETHERSCAN_API_KEY ||
    !chainId ||
    chain.id === 'bsc'
  ) {
    return null;
  }

  const url = new URL(
    'https://api.etherscan.io/v2/api'
  );

  url.searchParams.set(
    'chainid',
    String(chainId)
  );

  url.searchParams.set(
    'module',
    'logs'
  );

  url.searchParams.set(
    'action',
    'getLogs'
  );

  url.searchParams.set(
    'address',
    tokenAddress
  );

  url.searchParams.set(
    'topic0',
    TRANSFER_TOPIC0
  );

  url.searchParams.set(
    'fromBlock',
    String(fromBlock)
  );

  url.searchParams.set(
    'toBlock',
    'latest'
  );

  url.searchParams.set(
    'page',
    '1'
  );

  url.searchParams.set(
    'offset',
    '1000'
  );

  url.searchParams.set(
    'apikey',
    ETHERSCAN_API_KEY
  );

  try {
    const res = await fetch(
      url.toString()
    );

    if (!res.ok) {
      console.warn(
        `[${chain.id}] Etherscan getLogs HTTP ${res.status} — falling back to RPC`
      );

      return null;
    }

    const json = await res.json();

    if (
      json.status !== '1' ||
      !Array.isArray(json.result)
    ) {
      if (
        json.message ===
        'No records found'
      ) {
        return [];
      }

      console.warn(
        `[${chain.id}] Etherscan getLogs returned status="${json.status}" message="${json.message}" — falling back to RPC`
      );

      return null;
    }

    return json.result.map(
      (log: any) => ({
        topics: log.topics,
        data: log.data,
        blockNumber: parseInt(
          log.blockNumber,
          16
        ),
      })
    );
  } catch (err: any) {
    console.warn(
      `[${chain.id}] Etherscan getLogs request failed: ${
        err?.message ?? err
      } — falling back to RPC`
    );

    return null;
  }
}

// ─── RPC log fetching ────────────────────────────────────────────────────────
//
// BSC Testnet is deliberately limited to 2,000-block requests.
// If a provider rejects a range, we retry the SAME range with smaller
// ranges instead of silently skipping blocks.

const EVM_LOG_CHUNK_BLOCKS: Record<
  string,
  number
> = {
  ethereum: 50_000,
  polygon: 10_000,
  bsc: 2_000,
};

async function fetchLogsViaRpc(
  chain: ChainConfig,
  tokenAddress: string,
  fromBlock: number,
  latestBlock: number
): Promise<RawLog[]> {
  const all: RawLog[] = [];

  const chunkSize =
    EVM_LOG_CHUNK_BLOCKS[chain.id] ??
    2_000;

  let from = fromBlock;

  while (from <= latestBlock) {
    const to = Math.min(
      from + chunkSize - 1,
      latestBlock
    );

    try {
      const logs =
        await withEvmFailover(
          chain,
          (provider) =>
            provider.getLogs({
              address: tokenAddress,
              topics: [
                TRANSFER_TOPIC0,
              ],
              fromBlock: from,
              toBlock: to,
            })
        );

      for (const log of logs) {
        all.push({
          topics:
            log.topics as string[],
          data: log.data,
          blockNumber:
            log.blockNumber,
        });
      }

      console.info(
        `[${chain.id}] scanned blocks ${from} → ${to}, found ${logs.length} Transfer logs`
      );

      from = to + 1;
    } catch (err: any) {
      console.warn(
        `[${chain.id}] failed scanning blocks ${from} → ${to}: ${
          err?.shortMessage ??
          err?.message ??
          err
        }`
      );

      // Retry the SAME area with half the range.
      const currentRange =
        to - from + 1;

      const smallerSize =
        Math.max(
          100,
          Math.floor(
            currentRange / 2
          )
        );

      const smallerTo =
        Math.min(
          from +
            smallerSize -
            1,
          latestBlock
        );

      try {
        const logs =
          await withEvmFailover(
            chain,
            (provider) =>
              provider.getLogs({
                address:
                  tokenAddress,
                topics: [
                  TRANSFER_TOPIC0,
                ],
                fromBlock: from,
                toBlock:
                  smallerTo,
              })
          );

        for (const log of logs) {
          all.push({
            topics:
              log.topics as string[],
            data: log.data,
            blockNumber:
              log.blockNumber,
          });
        }

        console.info(
          `[${chain.id}] retry scanned blocks ${from} → ${smallerTo}, found ${logs.length} Transfer logs`
        );

        from = smallerTo + 1;
      } catch (retryErr: any) {
        // IMPORTANT:
        // Do not silently skip blocks.
        // If even the smaller range fails, stop this scan.
        // The next polling cycle can retry it.
        throw new Error(
          `[${chain.id}] unable to scan blocks ${from} → ${smallerTo}: ${
            retryErr?.shortMessage ??
            retryErr?.message ??
            retryErr
          }`
        );
      }
    }
  }

  return all;
}

function applyRawLog(
  log: RawLog,
  balances: Map<string, bigint>
) {
  if (
    !log.topics[1] ||
    !log.topics[2]
  ) {
    return;
  }

  const from =
    ethers.getAddress(
      '0x' +
        log.topics[1].slice(26)
    );

  const to =
    ethers.getAddress(
      '0x' +
        log.topics[2].slice(26)
    );

  const value = BigInt(log.data);

  applyTransferDeltas(
    balances,
    from,
    to,
    value
  );
}

// ─── EVM token holders ───────────────────────────────────────────────────────

async function readEvmTokenHolders(
  chain: ChainConfig,
  tokenAddress: string
): Promise<TokenHolderData> {
  const decimals =
    await withEvmFailover(
      chain,
      (provider) =>
        new ethers.Contract(
          tokenAddress,
          ERC20_ABI,
          provider
        ).decimals()
    ).catch(() => 18);

  const cacheKey =
    `evm:${chain.id}:${tokenAddress.toLowerCase()}`;

  let cache =
    holderCaches.get(cacheKey);

  if (!cache) {
    // No deployment block is required.
    //
    // The scanner starts at block 0 for a new token cache.
    // Once the first scan completes, subsequent polls only scan
    // blocks after lastScannedBlock.
    cache = {
      balances:
        new Map<string, bigint>(),
      lastScannedBlock: -1,
    };

    holderCaches.set(
      cacheKey,
      cache
    );
  }

  const latestBlock =
    await withEvmFailover(
      chain,
      (provider) =>
        provider.getBlockNumber()
    );

  const fromBlock =
    cache.lastScannedBlock + 1;

  if (fromBlock <= latestBlock) {
    let logs: RawLog[];

    if (chain.id === 'bsc') {
      // IMPORTANT:
      // BSC Testnet does NOT use Etherscan here.
      // Direct RPC scanning is used instead.
      logs =
        await fetchLogsViaRpc(
          chain,
          tokenAddress,
          fromBlock,
          latestBlock
        );
    } else {
      // Ethereum / Polygon:
      // Try Etherscan first, then RPC.
      const etherscanLogs =
        await fetchLogsViaEtherscan(
          chain,
          tokenAddress,
          fromBlock
        );

      logs =
        etherscanLogs ??
        await fetchLogsViaRpc(
          chain,
          tokenAddress,
          fromBlock,
          latestBlock
        );
    }

    // Apply logs in block order.
    logs.sort(
      (a, b) =>
        a.blockNumber -
        b.blockNumber
    );

    for (const log of logs) {
      applyRawLog(
        log,
        cache.balances
      );
    }

    cache.lastScannedBlock =
      latestBlock;
  }

  return toHolderData(
    cache.balances,
    Number(decimals)
  );
}

async function readEvmChainHolders(
  chain: ChainConfig
): Promise<ChainHolderData> {
  const [
    INRX,
    EGOLD,
    ESLVR,
  ] = await Promise.all([
    readEvmTokenHolders(
      chain,
      chain.tokens.INRX
    ),
    readEvmTokenHolders(
      chain,
      chain.tokens.EGOLD
    ),
    readEvmTokenHolders(
      chain,
      chain.tokens.ESLVR
    ),
  ]);

  return {
    INRX,
    EGOLD,
    ESLVR,
  };
}

// ─── TRON holder enumeration ─────────────────────────────────────────────────

const tronTransferIface =
  new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]);

async function decodeTronTransferFromRawLog(
  chain: ChainConfig,
  txid: string
): Promise<{
  from: string;
  to: string;
  value: bigint;
} | null> {
  try {
    const res = await fetch(
      `${chain.rpc.replace(
        /\/$/,
        ''
      )}/wallet/gettransactioninfobyid`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',

          ...(TRONSCAN_API_KEY
            ? {
                'TRON-PRO-API-KEY':
                  TRONSCAN_API_KEY,
              }
            : {}),
        },
        body: JSON.stringify({
          value: txid,
        }),
      }
    );

    if (!res.ok) {
      return null;
    }

    const json =
      await res.json();

    for (const log of
      json?.log ?? []) {
      const topics: string[] =
        (log.topics ?? []).map(
          (t: string) =>
            t.startsWith('0x')
              ? t
              : `0x${t}`
        );

      const data = log.data
        ? log.data.startsWith(
            '0x'
          )
          ? log.data
          : `0x${log.data}`
        : '0x';

      if (!topics.length) {
        continue;
      }

      let parsed;

      try {
        parsed =
          tronTransferIface.parseLog(
            {
              topics,
              data,
            }
          );
      } catch {
        continue;
      }

      if (
        !parsed ||
        parsed.name !==
          'Transfer'
      ) {
        continue;
      }

      return {
        from:
          parsed.args
            .from as string,
        to:
          parsed.args
            .to as string,
        value:
          parsed.args
            .value as bigint,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function readTronTokenHolders(
  chain: ChainConfig,
  tokenAddress: string
): Promise<TokenHolderData> {
  const { TronWeb } =
    await loadTronWeb();

  const base58Address =
    tokenAddress.startsWith('T')
      ? tokenAddress
      : TronWeb.address.fromHex(
          tokenAddress
        );

  const cacheKey =
    `tron:${chain.id}:${tokenAddress}`;

  let cache =
    holderCaches.get(cacheKey);

  if (!cache) {
    cache = {
      balances:
        new Map<string, bigint>(),
      lastScannedBlock: 0,
    };

    holderCaches.set(
      cacheKey,
      cache
    );
  }

  let decimals = 6;

  let fingerprint:
    | string
    | null = null;

  let newestSeenTimestamp =
    cache.lastScannedBlock;

  for (
    let page = 0;
    page < 50;
    page++
  ) {
    const url =
      new URL(
        `${chain.rpc.replace(
          /\/$/,
          ''
        )}/v1/contracts/${base58Address}/events`
      );

    url.searchParams.set(
      'event_name',
      'Transfer'
    );

    url.searchParams.set(
      'limit',
      '200'
    );

    url.searchParams.set(
      'order_by',
      'block_timestamp,asc'
    );

    url.searchParams.set(
      'min_block_timestamp',
      String(
        cache.lastScannedBlock +
          1
      )
    );

    if (fingerprint) {
      url.searchParams.set(
        'fingerprint',
        fingerprint
      );
    }

    const res = await fetch(
      url.toString(),
      {
        headers:
          TRONSCAN_API_KEY
            ? {
                'TRON-PRO-API-KEY':
                  TRONSCAN_API_KEY,
              }
            : {},
      }
    );

    if (!res.ok) {
      break;
    }

    const json =
      await res.json();

    const events: any[] =
      json?.data ?? [];

    for (const event of events) {
      let fromHex: string;
      let toHex: string;
      let value: bigint;

      if (
        event.result &&
        (
          event.result.from ||
          event.result._from
        )
      ) {
        const fromT =
          event.result.from ??
          event.result._from;

        const toT =
          event.result.to ??
          event.result._to;

        const valT =
          event.result.value ??
          event.result._value;

        fromHex =
          ethers.getAddress(
            TronWeb.address
              .toHex(fromT)
              .replace(
                /^41/,
                '0x'
              )
          );

        toHex =
          ethers.getAddress(
            TronWeb.address
              .toHex(toT)
              .replace(
                /^41/,
                '0x'
              )
          );

        value = BigInt(valT);
      } else {
        const recovered =
          await decodeTronTransferFromRawLog(
            chain,
            event.transaction_id
          );

        if (!recovered) {
          continue;
        }

        fromHex =
          recovered.from;

        toHex =
          recovered.to;

        value =
          recovered.value;
      }

      applyTransferDeltas(
        cache.balances,
        fromHex,
        toHex,
        value
      );

      if (
        typeof event.block_timestamp ===
        'number'
      ) {
        newestSeenTimestamp =
          Math.max(
            newestSeenTimestamp,
            event.block_timestamp
          );
      }
    }

    fingerprint =
      json?.meta?.fingerprint ??
      null;

    if (
      !fingerprint ||
      events.length === 0
    ) {
      break;
    }
  }

  cache.lastScannedBlock =
    newestSeenTimestamp;

  try {
    const tronWeb =
      await getTronClient(chain);

    const contract =
      tronWeb.contract(
        TRC20_ABI,
        tokenAddress
      );

    decimals = Number(
      await contract
        .decimals()
        .call()
    );
  } catch {
    // Keep default of 6.
  }

  return toHolderData(
    cache.balances,
    decimals
  );
}

async function readTronChainHolders(
  chain: ChainConfig
): Promise<ChainHolderData> {
  const [
    INRX,
    EGOLD,
    ESLVR,
  ] = await Promise.all([
    readTronTokenHolders(
      chain,
      chain.tokens.INRX
    ),
    readTronTokenHolders(
      chain,
      chain.tokens.EGOLD
    ),
    readTronTokenHolders(
      chain,
      chain.tokens.ESLVR
    ),
  ]);

  return {
    INRX,
    EGOLD,
    ESLVR,
  };
}

export async function readTokenHolders(
  chain: ChainConfig
): Promise<ChainHolderData> {
  return chain.kind === 'tron'
    ? readTronChainHolders(chain)
    : readEvmChainHolders(chain);
}
