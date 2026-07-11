import { MarketPrices } from '../lib/priceApi';
import { formatUsd, formatInr } from '../lib/format';

function RateRow({
  symbol, unitLabel, inr, usd, accent,
}: { symbol: string; unitLabel: string; inr: string; usd: string; accent: string }) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4 rounded-xl border border-hairline bg-panel/60">
      <div className="flex items-center gap-3">
        <span className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-mono font-semibold"
          style={{ backgroundColor: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}>
          {symbol.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <div className="text-sm font-medium text-ivory">{symbol}</div>
          <div className="text-[11px] text-muted">{unitLabel}</div>
        </div>
      </div>
      <div className="text-right tnum font-mono">
        <div className="text-ivory text-sm">{inr}</div>
        <div className="text-muted text-xs">{usd}</div>
      </div>
    </div>
  );
}

export function TokenRates({ prices }: { prices: MarketPrices | null }) {
  return (
    <section>
      <h2 className="font-display text-lg text-ivory mb-3">Contract token rates</h2>
      <div className="space-y-2.5">
        <RateRow
          symbol="INRX" unitLabel="1 INRX = ₹1 (rupee-pegged)"
          inr="₹1.00"
          usd={prices ? formatUsd(1 / prices.usdInr) : '—'}
          accent="#E08D3C"
        />
        <RateRow
          symbol="EGold" unitLabel="1 EGold = 1 gram Gold"
          inr={prices ? formatInr(prices.goldInrPerGram) : '—'}
          usd={prices ? formatUsd(prices.goldUsdPerGram) : '—'}
          accent="#C9A24B"
        />
        <RateRow
          symbol="ESilver" unitLabel="1 ESilver = 1 gram Silver"
          inr={prices ? formatInr(prices.silverInrPerGram) : '—'}
          usd={prices ? formatUsd(prices.silverUsdPerGram) : '—'}
          accent="#B8C0C8"
        />
      </div>
    </section>
  );
}
