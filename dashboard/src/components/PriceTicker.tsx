import { MarketPrices } from '../lib/priceApi';
import { formatUsd, formatInr } from '../lib/format';
import { LiveDot } from './LiveDot';

function PriceCard({
  label, sub, primary, secondary, accent,
}: { label: string; sub: string; primary: string; secondary: string; accent: string }) {
  return (
    <div className="flex-1 min-w-[9.5rem] rounded-2xl border border-hairline bg-panel/70 px-4 py-3.5 shadow-panel">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</span>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
      </div>
      <div className="tnum text-lg font-mono font-medium text-ivory leading-tight">{primary}</div>
      <div className="tnum text-xs font-mono text-muted mt-0.5">{secondary}</div>
      <div className="text-[10px] text-muted/70 mt-1">{sub}</div>
    </div>
  );
}

export function PriceTicker({ prices, loading, error }: { prices: MarketPrices | null; loading: boolean; error: string | null }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg text-ivory">Live market prices</h2>
        <LiveDot ok={!error} />
      </div>

      {!prices ? (
        <div className="text-sm text-muted">{loading ? 'Fetching live prices…' : error ?? 'No data'}</div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <PriceCard
            label="USDT" sub="Tether"
            primary={formatUsd(prices.usdtUsd)}
            secondary={formatInr(prices.usdtInr)}
            accent="#6FCF97"
          />
          <PriceCard
            label="USD" sub="US Dollar"
            primary="$1.00"
            secondary={formatInr(prices.usdInr)}
            accent="#B8C0C8"
          />
          <PriceCard
            label="INR" sub="Indian Rupee"
            primary="₹1.00"
            secondary={formatUsd(1 / prices.usdInr)}
            accent="#E08D3C"
          />
          <PriceCard
            label="Gold" sub="per gram, XAU"
            primary={`${formatUsd(prices.goldUsdPerGram)} / g`}
            secondary={`${formatInr(prices.goldInrPerGram)} / g`}
            accent="#C9A24B"
          />
          <PriceCard
            label="Silver" sub="per gram, XAG"
            primary={`${formatUsd(prices.silverUsdPerGram)} / g`}
            secondary={`${formatInr(prices.silverInrPerGram)} / g`}
            accent="#B8C0C8"
          />
        </div>
      )}
    </section>
  );
}
