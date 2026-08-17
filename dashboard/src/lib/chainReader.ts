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
  totalHeld: number; // == total minted currently in circulation (sum of every holder, incl. the bridge)
}

export interface ChainHolderData {
  INRX: TokenHolderData;
  EGOLD: TokenHolderData;
  ESLVR: TokenHolderData;
}

// ─── API keys (optional — everything still works without them, just falls
// back to plain RPC calls, which is slower and more rate-limit-prone) ───────
const ETHERSCAN_API_KEY = import.meta.env.VITE_ETHERSCAN_API_KEY || '';
const TRONSCAN_API_KEY = import.meta.env.VITE_TRONSCAN_API_KEY || '';

// Etherscan's V2 API unifies all EVM chains behind one key + a chainid
// param (https://api.etherscan.io/v2/api?chainid=...). These must match the
// same chain IDs already used in bridge-service's signing logic.
const ETHERSCAN_CHAIN_IDS: Record<string, number> = {
  ethereum: 11155111, // Sepolia
  polygon: 80002,     // Polygon Amoy
  bsc: 97,            // BSC testnet
};

// ─── Providers / clients (cached per chain) ─────────────────────────────────

const evmProviders = new Map<string, ethers.JsonRpcProvider>();
function getEvmProvider(chain: ChainConfig): ethers.JsonRpcProvider {
  let provider = evmProviders.get(chain.id);
  if (!provider) {
    const fetchRequest = new ethers.FetchRequest(chain.rpc);
    fetchRequest.timeout = 20_000;
    provider = new ethers.JsonRpcProvider(fetchRequest, undefined, { batchMaxCount: 1 });
    evmProviders.set(chain.id, provider);
  }
  return provider;
}

let tronWebModulePromise: Promise<typeof import('tronweb')> | null = null;
function loadTronWeb() {
  if (!tronWebModulePromise) tronWebModulePromise = import('tronweb');
  return tronWebModulePromise;
}

const tronClients = new Map<string, any>();
async function getTronClient(chain: ChainConfig) {
  let client = tronClients.get(chain.id);
  if (!client) {
    const { TronWeb } = await loadTronWeb();
    client = new TronWeb({ fullHost: chain.rpc });
    // TronWeb needs SOME address set as calling context even for a
    // read-only .call() — without it the node rejects the request with
    // "class java.security.InvalidParameterException: owner_address isn't
    // set." Nothing is spent/authorized by this; any valid address works.
    client.setAddress(chain.tokens.INRX);
    tronClients.set(chain.id, client);
  }
  return client;
}

// ─── Legacy: single-address balance (kept for anything still using it) ──────

async function readEvmTokenBalance(provider: ethers.JsonRpcProvider, tokenAddress: string, holderAddress: string): Promise<number> {
  if (!holderAddress) return 0;
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const [raw, decimals] = await Promise.all([
    contract.balanceOf(holderAddress),
    contract.decimals().catch(() => 18),
  ]);
  return Number(ethers.formatUnits(raw, decimals));
}

async function readEvmBalances(chain: ChainConfig): Promise<TokenBalances> {
  const provider = getEvmProvider(chain);
  const [INRX, EGOLD, ESLVR] = await Promise.all([
    readEvmTokenBalance(provider, chain.tokens.INRX, chain.bridge),
    readEvmTokenBalance(provider, chain.tokens.EGOLD, chain.bridge),
    readEvmTokenBalance(provider, chain.tokens.ESLVR, chain.bridge),
  ]);
  return { INRX, EGOLD, ESLVR };
}

async function readTronTokenBalance(tronWeb: any, tokenAddress: string, holderAddress: string): Promise<number> {
  if (!holderAddress) return 0;
  const contract = tronWeb.contract(TRC20_ABI, tokenAddress);
  const [raw, decimals] = await Promise.all([
    contract.balanceOf(holderAddress).call(),
    contract.decimals().call().catch(() => 18),
  ]);
  return Number(ethers.formatUnits(raw.toString(), Number(decimals)));
}

async function readTronBalances(chain: ChainConfig): Promise<TokenBalances> {
  const tronWeb = await getTronClient(chain);
  const [INRX, EGOLD, ESLVR] = await Promise.all([
    readTronTokenBalance(tronWeb, chain.tokens.INRX, chain.bridge),
    readTronTokenBalance(tronWeb, chain.tokens.EGOLD, chain.bridge),
    readTronTokenBalance(tronWeb, chain.tokens.ESLVR, chain.bridge),
  ]);
  return { INRX, EGOLD, ESLVR };
}

export async function readContractBalances(chain: ChainConfig): Promise<TokenBalances> {
  return chain.kind === 'tron' ? readTronBalances(chain) : readEvmBalances(chain);
}

// ─── Holder enumeration ──────────────────────────────────────────────────────
//
// Plain RPC has no "list all holders" call — the standard way to reconstruct
// it (what Etherscan's own Holders tab is built from) is replaying every
// Transfer(from, to, value) event since deployment and tracking running
// balances: subtract from `from`, add to `to`. Summing every holder's final
// balance gives total tokens currently minted/in circulation (mint/burn are
// the only things that change that sum; ordinary transfers just move it
// between holders) — which is exactly "total minted" for the dashboard.

const TRANSFER_TOPIC0 = ethers.id('Transfer(address,address,uint256)');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function applyTransferDeltas(
  balances: Map<string, bigint>,
  from: string,
  to: string,
  value: bigint,
) {
  if (from !== ZERO_ADDRESS) {
    balances.set(from, (balances.get(from) ?? 0n) - value);
  }
  if (to !== ZERO_ADDRESS) {
    balances.set(to, (balances.get(to) ?? 0n) + value);
  }
}

function toHolderData(balances: Map<string, bigint>, decimals: number): TokenHolderData {
  const holders: TokenHolder[] = [];
  let totalHeld = 0;
  for (const [address, raw] of balances) {
    if (raw <= 0n) continue; // fully exited or dust-negative from rounding — not a current holder
    const balance = Number(ethers.formatUnits(raw, decimals));
    holders.push({ address, balance });
    totalHeld += balance;
  }
  holders.sort((a, b) => b.balance - a.balance);
  return { holders, holderCount: holders.length, totalHeld };
}

// Caches accumulated balances + how far we've scanned, per token contract —
// so a poll only has to fetch logs since the LAST scan, not replay full
// history every time. The first call for a given token pays the one-time
// full-history cost; every call after that is typically cheap (0-few new
// logs on a quiet testnet).
interface HolderCache {
  balances: Map<string, bigint>;
  lastScannedBlock: number; // EVM: block number. TRON: last-seen block_timestamp (ms).
}
const holderCaches = new Map<string, HolderCache>();

// ─── EVM log fetching: Etherscan V2 API first, raw RPC getLogs as fallback ──
//
// Etherscan's API has its own generous free-tier rate limit, completely
// separate from your RPC provider's (Infura/Ankr/etc) — this is what's
// actually reliable for scanning a contract's full history, instead of
// hammering the RPC endpoint directly with eth_getLogs and risking the
// same rate-limit problems seen elsewhere in this project. If no API key
// is configured, or the Etherscan call fails for any reason, this falls
// back to plain RPC getLogs so nothing breaks — just slower.

interface RawLog {
  topics: string[];
  data: string;
  blockNumber: number;
}

async function fetchLogsViaEtherscan(chain: ChainConfig, tokenAddress: string, fromBlock: number): Promise<RawLog[] | null> {
  const chainId = ETHERSCAN_CHAIN_IDS[chain.id];
  if (!ETHERSCAN_API_KEY || !chainId) return null; // no key configured, or an unmapped chain — caller falls back to RPC

  const url = new URL('https://api.etherscan.io/v2/api');
  url.searchParams.set('chainid', String(chainId));
  url.searchParams.set('module', 'logs');
  url.searchParams.set('action', 'getLogs');
  url.searchParams.set('address', tokenAddress);
  url.searchParams.set('topic0', TRANSFER_TOPIC0);
  url.searchParams.set('fromBlock', String(fromBlock));
  url.searchParams.set('toBlock', 'latest');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '1000'); // plenty for a testnet contract's full history
  url.searchParams.set('apikey', ETHERSCAN_API_KEY);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== '1' || !Array.isArray(json.result)) {
      // status "0" with an empty result just means "no logs found", which
      // is a valid (if boring) outcome — only treat it as a real failure
      // when the message says something went actually wrong.
      if (json.message === 'No records found') return [];
      return null;
    }
    return json.result.map((log: any) => ({
      topics: log.topics,
      data: log.data,
      blockNumber: parseInt(log.blockNumber, 16),
    }));
  } catch {
    return null; // network error, timeout, etc — fall back to RPC
  }
}

const EVM_LOG_CHUNK_BLOCKS = 50_000;

async function fetchLogsViaRpc(provider: ethers.JsonRpcProvider, tokenAddress: string, fromBlock: number, latestBlock: number): Promise<RawLog[]> {
  const all: RawLog[] = [];
  let from = fromBlock;
  while (from <= latestBlock) {
    const to = Math.min(from + EVM_LOG_CHUNK_BLOCKS - 1, latestBlock);
    try {
      const logs = await provider.getLogs({ address: tokenAddress, topics: [TRANSFER_TOPIC0], fromBlock: from, toBlock: to });
      for (const log of logs) all.push({ topics: log.topics as string[], data: log.data, blockNumber: log.blockNumber });
      from = to + 1;
    } catch {
      // This window was rejected (range too large for this RPC, or a
      // transient error) — retry with a much smaller window instead of
      // failing the whole scan over one bad chunk.
      const smallerTo = Math.min(from + Math.floor(EVM_LOG_CHUNK_BLOCKS / 5) - 1, latestBlock);
      try {
        const logs = await provider.getLogs({ address: tokenAddress, topics: [TRANSFER_TOPIC0], fromBlock: from, toBlock: smallerTo });
        for (const log of logs) all.push({ topics: log.topics as string[], data: log.data, blockNumber: log.blockNumber });
      } catch {
        // give up on this window entirely rather than looping forever
      }
      from = smallerTo + 1;
    }
  }
  return all;
}

function applyRawLog(log: RawLog, balances: Map<string, bigint>) {
  // topics[1]/topics[2] are the indexed from/to addresses, left-padded to 32
  // bytes; data is the ABI-encoded uint256 value.
  const from = ethers.getAddress('0x' + log.topics[1].slice(26));
  const to = ethers.getAddress('0x' + log.topics[2].slice(26));
  const value = BigInt(log.data);
  applyTransferDeltas(balances, from, to, value);
}

async function readEvmTokenHolders(chain: ChainConfig, tokenAddress: string): Promise<TokenHolderData> {
  const provider = getEvmProvider(chain);
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const decimals = await contract.decimals().catch(() => 18);

  const cacheKey = `evm:${tokenAddress}`;
  let cache = holderCaches.get(cacheKey);
  if (!cache) {
    cache = { balances: new Map<string, bigint>(), lastScannedBlock: -1 };
    holderCaches.set(cacheKey, cache);
  }

  const latestBlock = await provider.getBlockNumber();
  const fromBlock = cache.lastScannedBlock + 1;

  if (fromBlock <= latestBlock) {
    const etherscanLogs = await fetchLogsViaEtherscan(chain, tokenAddress, fromBlock);
    const logs = etherscanLogs ?? await fetchLogsViaRpc(provider, tokenAddress, fromBlock, latestBlock);
    for (const log of logs) applyRawLog(log, cache.balances);
    cache.lastScannedBlock = latestBlock;
  }

  return toHolderData(cache.balances, Number(decimals));
}

async function readEvmChainHolders(chain: ChainConfig): Promise<ChainHolderData> {
  const [INRX, EGOLD, ESLVR] = await Promise.all([
    readEvmTokenHolders(chain, chain.tokens.INRX),
    readEvmTokenHolders(chain, chain.tokens.EGOLD),
    readEvmTokenHolders(chain, chain.tokens.ESLVR),
  ]);
  return { INRX, EGOLD, ESLVR };
}

// TRON: TronGrid's REST events endpoint, paginated via its `fingerprint`
// cursor. Passing TRONSCAN_API_KEY as TRON-PRO-API-KEY gets a much higher
// rate limit than anonymous requests (harmless to include even if it turns
// out not to be accepted — the request just proceeds at the anonymous
// limit). TVM logs use the exact same encoding as EVM, so once we have the
// raw topics/data we reuse the same decode logic as the EVM path.
async function readTronTokenHolders(chain: ChainConfig, tokenAddress: string): Promise<TokenHolderData> {
  const { TronWeb } = await loadTronWeb();
  const base58Address = tokenAddress.startsWith('T') ? tokenAddress : TronWeb.address.fromHex(tokenAddress);

  const cacheKey = `tron:${chain.id}:${tokenAddress}`;
  let cache = holderCaches.get(cacheKey);
  if (!cache) {
    cache = { balances: new Map<string, bigint>(), lastScannedBlock: 0 }; // used as "last-seen block_timestamp" here
    holderCaches.set(cacheKey, cache);
  }

  let decimals = 6;
  let fingerprint: string | null = null;
  let newestSeenTimestamp = cache.lastScannedBlock;

  for (let page = 0; page < 50; page++) { // hard cap so a misbehaving API can't loop forever
    const url = new URL(`${chain.rpc.replace(/\/$/, '')}/v1/contracts/${base58Address}/events`);
    url.searchParams.set('event_name', 'Transfer');
    url.searchParams.set('limit', '200');
    url.searchParams.set('order_by', 'block_timestamp,asc');
    url.searchParams.set('min_block_timestamp', String(cache.lastScannedBlock + 1));
    if (fingerprint) url.searchParams.set('fingerprint', fingerprint);

    const res = await fetch(url.toString(), {
      headers: TRONSCAN_API_KEY ? { 'TRON-PRO-API-KEY': TRONSCAN_API_KEY } : {},
    });
    if (!res.ok) break;
    const json = await res.json();
    const events: any[] = json?.data ?? [];

    for (const event of events) {
      let fromHex: string, toHex: string, value: bigint;

      if (event.result && (event.result.from || event.result._from)) {
        // TronGrid already decoded it for us.
        const fromT = event.result.from ?? event.result._from;
        const toT = event.result.to ?? event.result._to;
        const valT = event.result.value ?? event.result._value;
        fromHex = ethers.getAddress(TronWeb.address.toHex(fromT).replace(/^41/, '0x'));
        toHex = ethers.getAddress(TronWeb.address.toHex(toT).replace(/^41/, '0x'));
        value = BigInt(valT);
      } else if (Array.isArray(event.topics) && event.data !== undefined) {
        // Fall back to manual decode from raw topics/data.
        fromHex = ethers.getAddress('0x' + event.topics[1].slice(-40));
        toHex = ethers.getAddress('0x' + event.topics[2].slice(-40));
        value = BigInt('0x' + event.data);
      } else {
        continue; // unrecognized shape — skip rather than crash the whole list
      }

      applyTransferDeltas(cache.balances, fromHex, toHex, value);
      if (typeof event.block_timestamp === 'number') {
        newestSeenTimestamp = Math.max(newestSeenTimestamp, event.block_timestamp);
      }
    }

    fingerprint = json?.meta?.fingerprint ?? null;
    if (!fingerprint || events.length === 0) break;
  }

  cache.lastScannedBlock = newestSeenTimestamp;

  try {
    const tronWeb = await getTronClient(chain);
    const contract = tronWeb.contract(TRC20_ABI, tokenAddress);
    decimals = Number(await contract.decimals().call());
  } catch {
    // keep the default of 6 (matches every token in this system)
  }

  return toHolderData(cache.balances, decimals);
}

async function readTronChainHolders(chain: ChainConfig): Promise<ChainHolderData> {
  const [INRX, EGOLD, ESLVR] = await Promise.all([
    readTronTokenHolders(chain, chain.tokens.INRX),
    readTronTokenHolders(chain, chain.tokens.EGOLD),
    readTronTokenHolders(chain, chain.tokens.ESLVR),
  ]);
  return { INRX, EGOLD, ESLVR };
}

export async function readTokenHolders(chain: ChainConfig): Promise<ChainHolderData> {
  return chain.kind === 'tron' ? readTronChainHolders(chain) : readEvmChainHolders(chain);
}