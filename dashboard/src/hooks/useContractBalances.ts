import { useEffect, useRef, useState } from 'react';
import { ChainConfig, BALANCES_POLL_MS } from '../lib/constants';
import { readContractBalances, TokenBalances } from '../lib/chainReader';

interface State {
  balances: TokenBalances | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
}

export function useContractBalances(chain: ChainConfig) {
  const [state, setState] = useState<State>({ balances: null, error: null, loading: true, updatedAt: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setState({ balances: null, error: null, loading: true, updatedAt: null });

    const tick = async () => {
      try {
        const balances = await readContractBalances(chain);
        if (mounted.current) setState({ balances, error: null, loading: false, updatedAt: Date.now() });
      } catch (err: any) {
        if (mounted.current) {
          setState((s) => ({ ...s, error: err.message ?? 'Failed to read contract balances', loading: false }));
        }
      }
    };

    tick();
    const id = setInterval(tick, BALANCES_POLL_MS);
    return () => { mounted.current = false; clearInterval(id); };
  }, [chain.id]);

  return state;
}
