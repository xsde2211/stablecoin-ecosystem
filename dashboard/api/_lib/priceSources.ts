// Shared by every function under /api — this is the SAME pricing logic as
// src/lib/priceApi.ts (the browser-side dashboard), rehosted server-side so
// stablecoin-service (and anything else) can call one stable URL instead of
// each hitting CoinGecko/gold-api.com directly. Keep both files in sync if
// you change the underlying formula.
//
// Caching here is in-memory (module-level variables), NOT localStorage —
// that API doesn't exist in a serverless function's Node runtime. It only
// persists for the lifetime of a "warm" function instance, which is a
// reasonable best-effort cache for a low-traffic pricing endpoint; it just
// isn't guaranteed to be shared across every concurrent instance the way a
// browser's localStorage is guaranteed to persist for one visitor.

export const TROY_OUNCE_IN_GRAMS = 31.1034768;
export const TETHER_INR_SPREAD = 0.20;

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

// ─── Metals (gold-api.com is capped ~10 req/hour on the free tier) ──────────
interface MetalsCache { goldUsdPerOz: number; silverUsdPerOz: number; fetchedAt: number }
let metalsCache: MetalsCache | null = null;
const METALS_TTL_MS = 7 * 60 * 1000;

export async function fetchMetalsUsdPerOz(): Promise<{ goldUsdPerOz: number; silverUsdPerOz: number }> {
  if (metalsCache && Date.now() - metalsCache.fetchedAt < METALS_TTL_MS) {
    return metalsCache;
  }
  try {
    const [goldRes, silverRes] = await Promise.all([
      fetchJson('https://api.gold-api.com/price/XAU'),
      fetchJson('https://api.gold-api.com/price/XAG'),
    ]);
    const goldUsdPerOz = Number(goldRes?.price);
    const silverUsdPerOz = Number(silverRes?.price);
    if (!goldUsdPerOz || !silverUsdPerOz) throw new Error('Invalid metals price response');

    metalsCache = { goldUsdPerOz, silverUsdPerOz, fetchedAt: Date.now() };
    return metalsCache;
  } catch (err) {
    if (metalsCache) return metalsCache; // stale beats nothing
    throw err;
  }
}

// ─── USD/INR: Tether/CoinGecko primary, forex fallback ──────────────────────
let usdtCache: { usdtUsd: number; usdtInr: number; fetchedAt: number } | null = null;
let forexFallbackCache: { rate: number; fetchedAt: number } | null = null;
const RATE_TTL_MS = 4 * 60 * 1000;

async function fetchUsdtPrices(): Promise<{ usdtUsd: number; usdtInr: number }> {
  if (usdtCache && Date.now() - usdtCache.fetchedAt < RATE_TTL_MS) return usdtCache;

  const res = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd,inr');
  const usdtUsd = Number(res?.tether?.usd);
  const usdtInr = Number(res?.tether?.inr);
  if (!usdtUsd || !usdtInr) throw new Error('Invalid USDT price response');

  usdtCache = { usdtUsd, usdtInr, fetchedAt: Date.now() };
  return usdtCache;
}

async function fetchUsdInrFallback(): Promise<number> {
  if (forexFallbackCache && Date.now() - forexFallbackCache.fetchedAt < RATE_TTL_MS) {
    return forexFallbackCache.rate;
  }
  let rate: number;
  try {
    const res = await fetchJson('https://open.er-api.com/v6/latest/USD');
    rate = Number(res?.rates?.INR);
    if (!rate) throw new Error('Invalid primary FX response');
  } catch {
    const res = await fetchJson('https://api.frankfurter.app/latest?from=USD&to=INR');
    rate = Number(res?.rates?.INR);
    if (!rate) throw new Error('Invalid fallback FX response');
  }
  forexFallbackCache = { rate, fetchedAt: Date.now() };
  return rate;
}

export async function getUsdInrRate(): Promise<{ usdInr: number; usdtUsd: number; usdtInr: number }> {
  try {
    const usdt = await fetchUsdtPrices();
    return { usdInr: usdt.usdtInr - TETHER_INR_SPREAD, usdtUsd: usdt.usdtUsd, usdtInr: usdt.usdtInr };
  } catch {
    const usdInr = await fetchUsdInrFallback();
    return { usdInr, usdtUsd: 1, usdtInr: usdInr };
  }
}

// Permissive CORS — this is public, non-sensitive market data, callable
// from the dashboard's own frontend and from stablecoin-service alike.
export function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}