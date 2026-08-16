import { MarketPrices } from '../lib/priceApi';
import { TokenBalances } from '../lib/chainReader';
import { formatInr, formatUsd } from '../lib/format';

export function PortfolioValue({
  balances, prices,
}: { balances: TokenBalances | null; prices: MarketPrices | null }) {
  const ready = balances && prices;

  // Each token's own value, shown independently — NOT summed into a
  // combined "total portfolio value". Array-driven on purpose: adding a
  // 4th (or 5th) reserve token later is one more entry here, nothing else
  // to restructure.
  const rows = ready
    ? [
        { label: 'INRX', valueInr: balances!.INRX * 1, color: '#E08D3C' },
        { label: 'EGold', valueInr: balances!.EGOLD * prices!.goldInrPerGram, color: '#C9A24B' },
        { label: 'ESilver', valueInr: balances!.ESLVR * prices!.silverInrPerGram, color: '#B8C0C8' },
      ]
    : [];

  return (
    <section className="rounded-2xl border border-gold/30 bg-gradient-to-br from-panel to-panel2 p-6 shadow-panel">
      <h2 className="font-display text-lg text-ivory mb-1">Contract value by token</h2>
      <p className="text-xs text-muted mb-5">Value of each reserve token balance held by the deployed contracts on this network — shown independently, not summed</p>

      {!ready ? (
        <div className="text-sm text-muted">Waiting for balances and live prices…</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {rows.map((row) => (
            <div key={row.label} className="rounded-xl border border-hairline bg-panel2/60 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="text-xs text-muted">{row.label}</span>
              </div>
              <div className="tnum font-mono text-2xl font-medium text-gold leading-tight">{formatInr(row.valueInr)}</div>
              <div className="tnum font-mono text-xs text-muted mt-0.5">{formatUsd(row.valueInr / prices!.usdInr)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}