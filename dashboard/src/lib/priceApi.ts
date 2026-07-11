import { METALS_POLL_MS, TROY_OUNCE_IN_GRAMS } from './constants';

export interface MarketPrices {
  usdInr: number;       // 1 USD in INR
  usdtUsd: number;      // 1 USDT in USD (live, may drift slightly from 1.00)
  usdtInr: number;      // 1 USDT in INR (real market cross rate, not usdtUsd*usdInr)
  goldUsdPerGram: number;
  goldInrPerGram: number;
  silverUsdPerGram: number;
  silverInrPerGram: number;
  updatedAt: number;
}

const LS_KEY = 'reserve-dashboard:metals-cache:v1';

interface MetalsCache {
  goldUsdPerOz: number;
  silverUsdPerOz: number;
  fetchedAt: number;
}

function readMetalsCache(): MetalsCache | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MetalsCache;
  } catch {
    return null;
  }
}

function writeMetalsCache(cache: MetalsCache) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable (private browsing, etc.) — fine, just skip caching
  }
}

async function fetchJson(url: string, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// gold-api.com is capped around 10 req/hour on the free tier. A page reload
// (or a second browser tab) within the poll window reuses the cached value
// instead of spending another call — this is what keeps a handful of
// visitors from blowing through the budget within the same hour.
async function fetchMetalsUsdPerOz(): Promise<{ goldUsdPerOz: number; silverUsdPerOz: number; fromCache: boolean }> {
  const cached = readMetalsCache();
  const fresh = cached && Date.now() - cached.fetchedAt < METALS_POLL_MS;
  if (fresh && cached) {
    return { goldUsdPerOz: cached.goldUsdPerOz, silverUsdPerOz: cached.silverUsdPerOz, fromCache: true };
  }

  try {
    const [goldRes, silverRes] = await Promise.all([
      fetchJson('https://api.gold-api.com/price/XAU'),
      fetchJson('https://api.gold-api.com/price/XAG'),
    ]);
    const goldUsdPerOz = Number(goldRes?.price);
    const silverUsdPerOz = Number(silverRes?.price);
    if (!goldUsdPerOz || !silverUsdPerOz) throw new Error('Invalid metals price response');

    writeMetalsCache({ goldUsdPerOz, silverUsdPerOz, fetchedAt: Date.now() });
    return { goldUsdPerOz, silverUsdPerOz, fromCache: false };
  } catch (err) {
    // Live fetch failed (rate-limited, network blip, etc.) — fall back to
    // whatever we last had, even if stale, rather than showing nothing.
    if (cached) return { goldUsdPerOz: cached.goldUsdPerOz, silverUsdPerOz: cached.silverUsdPerOz, fromCache: true };
    throw err;
  }
}

// USD/INR: open.er-api.com primary, frankfurter.app fallback — same
// resilience pattern used on the backend oracle feed (two independent
// sources so one outage doesn't blank the whole dashboard).
async function fetchUsdInr(): Promise<number> {
  try {
    const res = await fetchJson('https://open.er-api.com/v6/latest/USD');
    const rate = Number(res?.rates?.INR);
    if (!rate) throw new Error('Invalid primary FX response');
    return rate;
  } catch {
    const res = await fetchJson('https://api.frankfurter.app/latest?from=USD&to=INR');
    const rate = Number(res?.rates?.INR);
    if (!rate) throw new Error('Invalid fallback FX response');
    return rate;
  }
}

// USDT's real live market price in USD and INR — sourced directly from
// CoinGecko rather than derived (usdInr * 1), since USDT does trade at a
// slight premium/discount to $1 in practice and the brief asks for its
// actual live price.
async function fetchUsdtPrices(): Promise<{ usdtUsd: number; usdtInr: number }> {
  const res = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd,inr');
  const usdtUsd = Number(res?.tether?.usd);
  const usdtInr = Number(res?.tether?.inr);
  if (!usdtUsd || !usdtInr) throw new Error('Invalid USDT price response');
  return { usdtUsd, usdtInr };
}

export async function fetchMarketPrices(): Promise<MarketPrices> {
  const [{ goldUsdPerOz, silverUsdPerOz }, usdInr, usdt] = await Promise.all([
    fetchMetalsUsdPerOz(),
    fetchUsdInr(),
    fetchUsdtPrices().catch(() => null), // don't let a CoinGecko hiccup take down the whole page
  ]);

  const goldUsdPerGram = goldUsdPerOz / TROY_OUNCE_IN_GRAMS;
  const silverUsdPerGram = silverUsdPerOz / TROY_OUNCE_IN_GRAMS;

  return {
    usdInr,
    usdtUsd: usdt?.usdtUsd ?? 1,
    usdtInr: usdt?.usdtInr ?? usdInr,
    goldUsdPerGram,
    goldInrPerGram: goldUsdPerGram * usdInr,
    silverUsdPerGram,
    silverInrPerGram: silverUsdPerGram * usdInr,
    updatedAt: Date.now(),
  };
}
