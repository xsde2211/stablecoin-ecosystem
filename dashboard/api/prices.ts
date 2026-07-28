import { fetchMetalsUsdPerOz, getUsdInrRate, setCors, TROY_OUNCE_IN_GRAMS } from './_lib/priceSources';

// This is the one stablecoin-service actually calls — everything it needs
// (USD/INR rate, gold/silver per gram in both USD and INR) in a single
// request instead of two.
export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const [{ goldUsdPerOz, silverUsdPerOz }, { usdInr, usdtUsd, usdtInr }] = await Promise.all([
      fetchMetalsUsdPerOz(),
      getUsdInrRate(),
    ]);

    const goldUsdPerGram = goldUsdPerOz / TROY_OUNCE_IN_GRAMS;
    const silverUsdPerGram = silverUsdPerOz / TROY_OUNCE_IN_GRAMS;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=180');
    return res.status(200).json({
      usdInr,
      usdtUsd,
      usdtInr,
      goldUsdPerGram,
      goldInrPerGram: goldUsdPerGram * usdInr,
      silverUsdPerGram,
      silverInrPerGram: silverUsdPerGram * usdInr,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(502).json({ error: err.message ?? 'Failed to fetch prices' });
  }
}