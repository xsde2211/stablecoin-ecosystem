import { ethers } from 'ethers';
import { ChainConfig, ERC20_ABI, TRC20_ABI } from './constants';

export interface TokenBalances {
  INRX: number;
  EGOLD: number;
  ESLVR: number;
}

// Caches one ethers provider per chain so we're not reconnecting on every
// poll tick.
const evmProviders = new Map<string, ethers.JsonRpcProvider>();
function getEvmProvider(chain: ChainConfig): ethers.JsonRpcProvider {
  let provider = evmProviders.get(chain.id);
  if (!provider) {
    provider = new ethers.JsonRpcProvider(chain.rpc, undefined, { batchMaxCount: 1 });
    evmProviders.set(chain.id, provider);
  }
  return provider;
}

// THE FIX: "balance held by the deployed contract" means how many tokens
// are currently LOCKED in the BRIDGE contract — that's the collateral
// backing whatever's been minted on other chains via the lock-and-mint
// flow (StablecoinBridgeV2.lock() does token.transferFrom(user, bridge,
// amount), so locked funds accumulate in the BRIDGE's balance). This used
// to query contract.balanceOf(tokenAddress) — the TOKEN checking its OWN
// balance of itself, which is always 0 unless a token is specifically
// designed to hold its own supply (none of these are). That's exactly why
// 16 real INRX sitting in the bridge (confirmed directly via Etherscan's
// holder list) still showed as 0 here.
async function readEvmTokenBalance(provider: ethers.JsonRpcProvider, tokenAddress: string, bridgeAddress: string): Promise<number> {
  if (!bridgeAddress) return 0; // bridge address not configured for this chain — nothing to read
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const [raw, decimals] = await Promise.all([
    contract.balanceOf(bridgeAddress),
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

// tronweb pulls in a fair amount of code — only load it once a Tron chain
// is actually selected, so EVM-only visits stay light.
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
    // THE OTHER FIX: TronWeb needs SOME address set as calling context even
    // for a read-only .call() — without it, the node rejects the request
    // with "class java.security.InvalidParameterException: owner_address
    // isn't set." Nothing is spent or authorized by this; any valid TRON
    // address works, so the token contract's own address (always present,
    // unlike bridge which can be unconfigured) is used purely as a
    // placeholder caller.
    client.setAddress(chain.tokens.INRX);
    tronClients.set(chain.id, client);
  }
  return client;
}

async function readTronTokenBalance(tronWeb: any, tokenAddress: string, bridgeAddress: string): Promise<number> {
  if (!bridgeAddress) return 0;
  const contract = tronWeb.contract(TRC20_ABI, tokenAddress);
  const [raw, decimals] = await Promise.all([
    contract.balanceOf(bridgeAddress).call(),
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