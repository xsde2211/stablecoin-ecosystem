import { useEffect, useRef, useState } from 'react';
import { ChainConfig, BALANCES_POLL_MS } from '../lib/constants';
import { readTokenHolders, ChainHolderData } from '../lib/chainReader';

interface State {
  holders: ChainHolderData | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
}

export function useContractBalances(chain: ChainConfig) {
  const [state, setState] = useState<State>({ holders: null, error: null, loading: true, updatedAt: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setState({ holders: null, error: null, loading: true, updatedAt: null });

    const tick = async () => {
      try {
        const holders = await readTokenHolders(chain);
        if (mounted.current) setState({ holders, error: null, loading: false, updatedAt: Date.now() });
      } catch (err: any) {
        if (mounted.current) {
          setState((s) => ({ ...s, error: err.message ?? 'Failed to read token holders', loading: false }));
        }
      }
    };

    tick();
    // readTokenHolders() is incrementally cached in chainReader.ts (only
    // fetches NEW logs since the last scan), so polling this on the normal
    // interval is cheap after the first load.
    const id = setInterval(tick, BALANCES_POLL_MS);
    return () => { mounted.current = false; clearInterval(id); };
  }, [chain.id]);

  return state;
}