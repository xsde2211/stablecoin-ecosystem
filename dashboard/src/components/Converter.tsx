import { useState } from 'react';
import { MarketPrices } from '../lib/priceApi';

type Direction = 'usdtToInrx' | 'inrxToUsdt';

export function Converter({ prices }: { prices: MarketPrices | null }) {
  const [direction, setDirection] = useState<Direction>('usdtToInrx');
  const [amount, setAmount] = useState('10');

  const rate = prices?.usdtInr ?? null; // 1 USDT = `rate` INRX (INRX pegged 1:1 to INR)
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  const result = rate && valid
    ? direction === 'usdtToInrx'
      ? parsed * rate
      : parsed / rate
    : null;

  const flip = () => {
    setDirection((d) => (d === 'usdtToInrx' ? 'inrxToUsdt' : 'usdtToInrx'));
    if (result !== null) setAmount(result.toFixed(direction === 'usdtToInrx' ? 2 : 4));
  };

  const fromLabel = direction === 'usdtToInrx' ? 'USDT' : 'INRX';
  const toLabel = direction === 'usdtToInrx' ? 'INRX' : 'USDT';

  return (
    <section className="rounded-2xl border border-hairline bg-panel/70 p-5 shadow-panel">
      <h2 className="font-display text-lg text-ivory mb-4">Converter</h2>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-[11px] uppercase tracking-[0.1em] text-muted block mb-1.5">{fromLabel}</label>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-panel2 border border-hairline rounded-xl px-3 py-2.5 tnum font-mono text-ivory
                       focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50"
          />
        </div>

        <button
          onClick={flip}
          aria-label="Swap direction"
          className="mt-5 h-9 w-9 shrink-0 rounded-full border border-hairline bg-panel2 text-muted hover:text-gold hover:border-gold/40 transition-colors"
        >
          ⇄
        </button>

        <div className="flex-1">
          <label className="text-[11px] uppercase tracking-[0.1em] text-muted block mb-1.5">{toLabel}</label>
          <div className="w-full bg-panel2/60 border border-hairline rounded-xl px-3 py-2.5 tnum font-mono text-gold">
            {result !== null ? result.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted mt-3">
        {rate
          ? `1 USDT ≈ ${rate.toLocaleString('en-US', { maximumFractionDigits: 4 })} INRX — live market cross rate`
          : 'Fetching live rate…'}
      </p>
    </section>
  );
}
