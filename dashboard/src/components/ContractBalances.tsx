import { useState } from 'react';
import { ChainConfig } from '../lib/constants';
import { ChainHolderData, TokenHolderData } from '../lib/chainReader';
import { formatToken, shortAddress, formatCompactAge } from '../lib/format';
import { LiveDot } from './LiveDot';

const TOKENS: { key: keyof ChainHolderData; label: string; accent: string }[] = [
  { key: 'INRX', label: 'INRX', accent: '#E08D3C' },
  { key: 'EGOLD', label: 'EGold', accent: '#C9A24B' },
  { key: 'ESLVR', label: 'ESilver', accent: '#B8C0C8' },
];

export function ContractBalances({
  chain, holders, loading, error, updatedAt,
}: {
  chain: ChainConfig;
  holders: ChainHolderData | null;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
}) {
  // No router in this project — a click opens this token's holder
  // breakdown as an overlay instead of navigating to a separate route.
  // Functionally the same "drill in and see who holds what" experience.
  const [openToken, setOpenToken] = useState<(typeof TOKENS)[number] | null>(null);

  return (
    <section className="rounded-2xl border border-hairline bg-panel/70 p-5 shadow-panel">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-display text-lg text-ivory">Total minted</h2>
        <LiveDot ok={!error} />
      </div>
      <p className="text-xs text-muted mb-4">
        Total supply currently in circulation on <span className="text-ivory">{chain.label}</span> — every holder's balance summed, bridge included. Click a token to see who holds what.
        {updatedAt && <> · updated {formatCompactAge(Date.now() - updatedAt)}</>}
      </p>

      {error && !holders && (
        <div className="text-sm text-down">{error}</div>
      )}
      {!holders && !error && (
        <div className="text-sm text-muted">{loading ? 'Scanning on-chain transfer history…' : 'No data'}</div>
      )}

      {holders && (
        <div className="divide-y divide-hairline">
          {TOKENS.map((row) => {
            const data: TokenHolderData = holders[row.key];
            return (
              <button
                key={row.key}
                onClick={() => setOpenToken(row)}
                className="w-full py-3 flex items-center justify-between text-left hover:bg-white/[0.03] transition-colors rounded-lg px-1 -mx-1"
              >
                <div className="flex items-center gap-2.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.accent }} />
                  <div>
                    <div className="text-sm text-ivory">{row.label}</div>
                    <div className="text-[11px] text-muted font-mono">{shortAddress(chain.tokens[row.key])}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="tnum font-mono text-ivory text-sm">{formatToken(data.totalHeld, row.label)}</div>
                  <div className="text-[11px] text-muted">
                    {data.holderCount} holder{data.holderCount === 1 ? '' : 's'} →
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {openToken && holders && (
        <HolderDetailOverlay
          chain={chain}
          token={openToken}
          data={holders[openToken.key]}
          onClose={() => setOpenToken(null)}
        />
      )}
    </section>
  );
}

function HolderDetailOverlay({
  chain, token, data, onClose,
}: {
  chain: ChainConfig;
  token: { key: keyof ChainHolderData; label: string; accent: string };
  data: TokenHolderData;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl border border-hairline bg-panel p-5 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: token.accent }} />
            <h3 className="font-display text-lg text-ivory">{token.label} holders on {chain.label}</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ivory transition-colors text-xl leading-none px-1">
            ×
          </button>
        </div>
        <p className="text-xs text-muted mb-4 font-mono">{chain.tokens[token.key]}</p>

        <div className="flex items-center justify-between mb-3 pb-3 border-b border-hairline">
          <span className="text-xs text-muted">{data.holderCount} holder{data.holderCount === 1 ? '' : 's'}</span>
          <span className="tnum font-mono text-ivory text-sm">Total: {formatToken(data.totalHeld, token.label)}</span>
        </div>

        {data.holders.length === 0 && (
          <div className="text-sm text-muted py-4 text-center">No holders yet</div>
        )}

        <div className="space-y-2">
          {data.holders.map((holder, i) => (
            <div key={holder.address} className="flex items-center justify-between text-xs">
              <span className="text-muted w-5">{i + 1}.</span>
              <span className="font-mono text-muted flex-1 mx-2">{shortAddress(holder.address)}</span>
              <span className="tnum font-mono text-ivory">{formatToken(holder.balance, token.label)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}