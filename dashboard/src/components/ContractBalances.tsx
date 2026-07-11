import { ChainConfig } from '../lib/constants';
import { TokenBalances } from '../lib/chainReader';
import { formatToken, shortAddress, formatCompactAge } from '../lib/format';
import { LiveDot } from './LiveDot';
import { useEffect, useState } from 'react';

const ROWS: { key: keyof TokenBalances; label: string; accent: string }[] = [
  { key: 'INRX', label: 'INRX', accent: '#E08D3C' },
  { key: 'EGOLD', label: 'EGold', accent: '#C9A24B' },
  { key: 'ESLVR', label: 'ESilver', accent: '#B8C0C8' },
];

export function ContractBalances({
  chain, balances, loading, error, updatedAt,
}: {
  chain: ChainConfig;
  balances: TokenBalances | null;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
}) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="rounded-2xl border border-hairline bg-panel/70 p-5 shadow-panel">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-lg text-ivory">Smart contract balances</h2>
        <LiveDot ok={!error} />
      </div>
      <p className="text-xs text-muted mb-4">
        Tokens locked in the bridge contract on <span className="text-ivory">{chain.label}</span> — the collateral backing what's minted elsewhere, not your wallet.
        {updatedAt && <> · updated {formatCompactAge(Date.now() - updatedAt)}</>}
      </p>

      {error && !balances && (
        <div className="text-sm text-down">{error}</div>
      )}
      {!balances && !error && (
        <div className="text-sm text-muted">{loading ? 'Reading on-chain balances…' : 'No data'}</div>
      )}

      {balances && (
        <div className="divide-y divide-hairline">
          {ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.accent }} />
                <div>
                  <div className="text-sm text-ivory">{row.label}</div>
                  <div className="text-[11px] text-muted font-mono">{shortAddress(chain.tokens[row.key])}</div>
                </div>
              </div>
              <div className="tnum font-mono text-ivory text-sm">{formatToken(balances[row.key], row.label)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}