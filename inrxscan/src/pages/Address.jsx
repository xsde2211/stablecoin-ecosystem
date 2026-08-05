import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Copy, Check } from 'lucide-react';
import TxTable from '../components/TxTable';
import NetworkSelect from '../components/NetworkSelect';
import ErrorState from '../components/ErrorState';
import RelatedAddressCard from '../components/RelatedAddressCard';
import { formatAmount } from '../lib/format';
import { explorer } from '../lib/api';

export default function Address() {
  const { address } = useParams();
  const [params, setParams] = useSearchParams();
  const chain = params.get('chain') || 'all';

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    explorer.address(address, { chain }).then(setData).catch(setError);
  }, [address, chain]);

  function setChain(c) {
    setParams(c !== 'all' ? { chain: c } : {});
  }

  return (
    <div className="mx-auto max-w-7xl px-4 lg:px-8 py-10">
      <p className="text-xs uppercase tracking-wider text-paper-faint mb-1">Wallet Address</p>
      <div className="flex items-center gap-2 mb-6">
        <h1 className="font-mono text-lg sm:text-xl font-semibold text-paper break-all">{address}</h1>
        <button
          onClick={() => { navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          className="text-paper-faint hover:text-paper transition-colors shrink-0"
        >
          {copied ? <Check size={15} className="text-mint" /> : <Copy size={15} />}
        </button>
      </div>

      {error ? (
        <ErrorState message={error.message} />
      ) : (
        <>
          {data && (
            <RelatedAddressCard
              address={address}
              relatedAddress={data.relatedAddress}
              balancesByNetwork={data.balancesByNetwork}
            />
          )}

          {/* ── Balance, per network + total ─────────────────────── */}
          <div className="mb-6">
            <div className="text-[11px] uppercase tracking-wider text-paper-faint mb-2">INRX Balance by Network</div>
            <div className="flex flex-wrap gap-3">
              <div className="card-lift border border-gold/30 bg-gold/[0.06] rounded-lg px-5 py-4 min-w-[180px]">
                <div className="text-[11px] uppercase tracking-wider text-paper-faint mb-1">Total (all networks)</div>
                <div className="font-display text-xl font-semibold text-gold">
                  {data ? formatAmount(data.totalBalance ?? data.balance) : '—'}
                </div>
              </div>
              {data?.balancesByNetwork?.map(b => (
                <div key={b.chain} className="card-lift border border-ink-line bg-ink-raised/70 rounded-lg px-5 py-4 min-w-[180px]">
                  <div className="text-[11px] uppercase tracking-wider text-paper-faint mb-1">{b.chainLabel}</div>
                  <div className="font-display text-lg font-semibold text-paper">{formatAmount(b.balance)}</div>
                </div>
              ))}
              {data && !data.balancesByNetwork?.length && (
                <div className="text-sm text-paper-dim px-1 py-4">No recorded INRX activity on any network yet.</div>
              )}
              {!data && (
                <div className="border border-ink-line bg-ink-raised/70 rounded-lg px-5 py-4 min-w-[180px] animate-pulse h-[70px]" />
              )}
            </div>
          </div>

          <div className="card-lift border border-ink-line bg-ink-raised/70 rounded-lg px-5 py-4 inline-block mb-6">
            <div className="text-[11px] uppercase tracking-wider text-paper-faint mb-1">Total Transactions</div>
            <div className="font-display text-xl font-semibold text-paper">{data ? data.txCount.toLocaleString('en-IN') : '—'}</div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-semibold text-paper">Transaction History</h2>
            <NetworkSelect value={chain} onChange={setChain} compact />
          </div>
          <div className="border border-ink-line rounded-lg bg-ink-raised/50 px-4">
            <TxTable rows={data?.data} loading={data === null} />
          </div>
        </>
      )}
    </div>
  );
}