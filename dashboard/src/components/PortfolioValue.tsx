import { MarketPrices } from '../lib/priceApi';
import { TokenBalances } from '../lib/chainReader';
import { formatInr, formatUsd } from '../lib/format';

export function PortfolioValue({
  balances, prices,
}: { balances: TokenBalances | null; prices: MarketPrices | null }) {
  const ready = balances && prices;

  const inrxValueInr = ready ? balances!.INRX * 1 : 0;
  const goldValueInr = ready ? balances!.EGOLD * prices!.goldInrPerGram : 0;
  const silverValueInr = ready ? balances!.ESLVR * prices!.silverInrPerGram : 0;
  const totalInr = inrxValueInr + goldValueInr + silverValueInr;
  const totalUsd = ready ? totalInr / prices!.usdInr : 0;

  const segments = ready && totalInr > 0
    ? [
        { label: 'INRX', value: inrxValueInr, color: '#E08D3C' },
        { label: 'EGold', value: goldValueInr, color: '#C9A24B' },
        { label: 'ESilver', value: silverValueInr, color: '#B8C0C8' },
      ]
    : [];

  return (
    <section className="rounded-2xl border border-gold/30 bg-gradient-to-br from-panel to-panel2 p-6 shadow-panel">
      <h2 className="font-display text-lg text-ivory mb-1">Total contract portfolio value</h2>
      <p className="text-xs text-muted mb-5">Sum of all reserve token balances held by the deployed contracts on this network</p>

      {!ready ? (
        <div className="text-sm text-muted">Waiting for balances and live prices…</div>
      ) : (
        <>
          <div className="flex items-baseline gap-3 mb-5">
            <span className="tnum font-mono text-4xl font-medium text-gold">{formatInr(totalInr)}</span>
            <span className="tnum font-mono text-lg text-muted">{formatUsd(totalUsd)}</span>
          </div>

          {/* Signature element: reserve composition — a proportional bar
              built from each asset's real, live contribution to total
              value, not a decorative chart. */}
          <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-panel2 border border-hairline">
            {segments.map((seg) => (
              <div
                key={seg.label}
                style={{ width: `${(seg.value / totalInr) * 100}%`, backgroundColor: seg.color }}
                title={`${seg.label}: ${formatInr(seg.value)}`}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3.5">
            {segments.map((seg) => (
              <div key={seg.label} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seg.color }} />
                <span className="text-muted">{seg.label}</span>
                <span className="tnum font-mono text-ivory">{formatInr(seg.value)}</span>
                <span className="tnum font-mono text-muted">
                  {totalInr > 0 ? `${((seg.value / totalInr) * 100).toFixed(1)}%` : '—'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
