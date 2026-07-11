import { useState } from 'react';
import { CHAINS, ChainId } from './lib/constants';
import { useMarketPrices } from './hooks/useMarketPrices';
import { useContractBalances } from './hooks/useContractBalances';
import { NetworkSelector } from './components/NetworkSelector';
import { PriceTicker } from './components/PriceTicker';
import { TokenRates } from './components/TokenRates';
import { Converter } from './components/Converter';
import { ContractBalances } from './components/ContractBalances';
import { PortfolioValue } from './components/PortfolioValue';
import { formatCompactAge } from './lib/format';
import { useEffect } from 'react';

export default function App() {
  const [networkId, setNetworkId] = useState<ChainId>('ethereum');
  const chain = CHAINS.find((c) => c.id === networkId)!;

  const { prices, loading: pricesLoading, error: pricesError } = useMarketPrices();
  const { balances, loading: balancesLoading, error: balancesError, updatedAt } = useContractBalances(chain);

  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-hairline">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted mb-0.5">Reserve Dashboard</div>
            <h1 className="font-display text-2xl text-ivory">INRX · EGold · ESilver</h1>
          </div>
          <NetworkSelector value={networkId} onChange={setNetworkId} />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-10">
        <PriceTicker prices={prices} loading={pricesLoading} error={pricesError} />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <TokenRates prices={prices} />
          </div>
          <div className="lg:col-span-2">
            <Converter prices={prices} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2">
            <ContractBalances
              chain={chain}
              balances={balances}
              loading={balancesLoading}
              error={balancesError}
              updatedAt={updatedAt}
            />
          </div>
          <div className="lg:col-span-3">
            <PortfolioValue balances={balances} prices={prices} />
          </div>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-8 text-xs text-muted/70 flex flex-wrap items-center justify-between gap-2">
        <span>Prices: gold-api.com (metals, ~7 min refresh) · open.er-api.com / frankfurter.app (USD/INR) · CoinGecko (USDT)</span>
        <span>{prices ? `Prices updated ${formatCompactAge(Date.now() - prices.updatedAt)}` : ''}</span>
      </footer>
    </div>
  );
}
