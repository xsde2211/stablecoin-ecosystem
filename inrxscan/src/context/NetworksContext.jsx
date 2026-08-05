import { createContext, useContext, useEffect, useState } from 'react';
import { explorer } from '../lib/api';

const NetworksContext = createContext(null);

const FALLBACK = {
  networks: {
    ethereum: { key: 'ethereum', label: 'Ethereum' },
    bsc:      { key: 'bsc',      label: 'BSC' },
    polygon:  { key: 'polygon',  label: 'Polygon' },
    tron:     { key: 'tron',     label: 'Tron' },
    solana:   { key: 'solana',   label: 'Solana' },
  },
  keys: ['ethereum', 'bsc', 'polygon', 'tron', 'solana'],
};

export function NetworksProvider({ children }) {
  const [data, setData] = useState(FALLBACK);

  useEffect(() => {
    explorer.networks().then(setData).catch(() => {}); // keep fallback on failure
  }, []);

  return <NetworksContext.Provider value={data}>{children}</NetworksContext.Provider>;
}

export function useNetworks() {
  const ctx = useContext(NetworksContext);
  if (!ctx) throw new Error('useNetworks must be used within NetworksProvider');
  return ctx;
}
