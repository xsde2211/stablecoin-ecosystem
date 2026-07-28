import { fetchMetalsUsdPerOz, getUsdInrRate, setCors, TROY_OUNCE_IN_GRAMS } from './_lib/priceSources';

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const [{ goldUsdPerOz, silverUsdPerOz }, { usdInr }] = await Promise.all([
      fetchMetalsUsdPerOz(),
      getUsdInrRate(),
    ]);

    const goldUsdPerGram = goldUsdPerOz / TROY_OUNCE_IN_GRAMS;
    const silverUsdPerGram = silverUsdPerOz / TROY_OUNCE_IN_GRAMS;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      goldUsdPerOz,
      silverUsdPerOz,
      goldUsdPerGram,
      goldInrPerGram: goldUsdPerGram * usdInr,
      silverUsdPerGram,
      silverInrPerGram: silverUsdPerGram * usdInr,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(502).json({ error: err.message ?? 'Failed to fetch metals price' });
  }
}