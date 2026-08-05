import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import TxTable from '../components/TxTable';
import NetworkSelect from '../components/NetworkSelect';
import DateRangeFilter from '../components/DateRangeFilter';
import ErrorState from '../components/ErrorState';
import { explorer } from '../lib/api';

// RECEIVE is intentionally absent — a transfer is one event, shown once,
// labeled SEND. See the backend's EXPLORER_TYPES comment for why.
const TYPES = ['', 'SEND', 'MINT', 'BURN', 'SWAP', 'BRIDGE_LOCK', 'BRIDGE_MINT'];
const LIMIT = 25;

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const page  = parseInt(params.get('page') || '1', 10);
  const type  = params.get('type') || '';
  const chain = params.get('chain') || 'all';
  const from  = params.get('from') || '';
  const to    = params.get('to') || '';

  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    explorer.transactions({ page, limit: LIMIT, type, chain, from, to })
      .then(setResult)
      .catch(setError);
  }, [page, type, chain, from, to]);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / LIMIT)) : 1;

  function patch(next) {
    setParams(prev => {
      const n = new URLSearchParams(prev);
      Object.entries(next).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      n.set('page', 1);
      return n;
    });
  }
  function setPage(p) {
    setParams(prev => { const n = new URLSearchParams(prev); n.set('page', p); return n; });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 lg:px-8 py-10">
      <h1 className="font-display text-2xl font-semibold text-paper mb-1">INRX Transactions</h1>
      <p className="text-sm text-paper-dim mb-6">
        {result ? `${result.total.toLocaleString('en-IN')} transactions found` : (error ? ' ' : 'Loading…')}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-2">
          {TYPES.map(t => (
            <button
              key={t || 'ALL'}
              onClick={() => patch({ type: t })}
              className={`rounded-full border px-3 py-1 text-xs font-mono transition-colors ${
                type === t
                  ? 'border-indigo-glow bg-indigo/15 text-indigo-glow'
                  : 'border-ink-line-2 text-paper-dim hover:text-paper hover:border-paper-faint'
              }`}
            >
              {t || 'ALL'}
            </button>
          ))}
        </div>
        <NetworkSelect value={chain} onChange={(c) => patch({ chain: c })} />
      </div>

      <div className="mb-4">
        <DateRangeFilter from={from} to={to} onChange={patch} />
      </div>

      <div className="border border-ink-line rounded-lg bg-ink-raised/40 px-4">
        {error ? <ErrorState message={error.message} /> : <TxTable rows={result?.data} loading={result === null} />}
      </div>

      {!error && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded-md border border-ink-line-2 px-3 py-1.5 text-paper-dim disabled:opacity-30 hover:enabled:text-paper hover:enabled:border-paper-faint transition-colors"
          >
            ← Prev
          </button>
          <span className="font-mono text-xs text-paper-faint">Page {page} of {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="rounded-md border border-ink-line-2 px-3 py-1.5 text-paper-dim disabled:opacity-30 hover:enabled:text-paper hover:enabled:border-paper-faint transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
