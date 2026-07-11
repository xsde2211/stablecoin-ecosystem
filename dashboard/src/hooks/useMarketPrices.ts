import { useEffect, useRef, useState } from 'react';
import { fetchMarketPrices, MarketPrices } from '../lib/priceApi';
import { FX_POLL_MS, METALS_POLL_MS } from '../lib/constants';

interface State {
  prices: MarketPrices | null;
  error: string | null;
  loading: boolean;
}

export function useMarketPrices() {
  const [state, setState] = useState<State>({ prices: null, error: null, loading: true });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    const tick = async () => {
      try {
        const prices = await fetchMarketPrices();
        if (mounted.current) setState({ prices, error: null, loading: false });
      } catch (err: any) {
        if (mounted.current) {
          setState((s) => ({ ...s, error: err.message ?? 'Failed to fetch prices', loading: false }));
        }
      }
    };

    tick();
    // Poll on the faster FX interval — the metals half of fetchMarketPrices
    // internally reuses its own cached value until METALS_POLL_MS has
    // elapsed, so this doesn't actually over-call the rate-limited API; it
    // just lets USD/INR and USDT refresh at their own faster cadence.
    const id = setInterval(tick, FX_POLL_MS);
    return () => { mounted.current = false; clearInterval(id); };
  }, []);

  return state;
}

export { METALS_POLL_MS };
