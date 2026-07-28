import { getUsdInrRate, setCors } from './_lib/priceSources';

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const { usdInr, usdtUsd, usdtInr } = await getUsdInrRate();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ usdInr, usdtUsd, usdtInr, updatedAt: new Date().toISOString() });
  } catch (err: any) {
    return res.status(502).json({ error: err.message ?? 'Failed to fetch USD/INR rate' });
  }
}