import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { Badge, Card, EmptyState, FullPageSpinner, Pagination, Select, formatDate, mono, statusVariant } from '../components/ui';

type TxRow = {
  id: string; txHash: string | null; chain: string; type: string;
  amount: string; tokenSymbol: string; fromAddress: string; toAddress: string;
  status: string; createdAt: string; confirmedAt: string | null;
  wallet: { userId: string; chain: string; address: string };
};

const CHAIN_OPTIONS = ['tron', 'ethereum', 'bsc', 'polygon', 'solana'].map((c) => ({ label: c.toUpperCase(), value: c }));
const STATUS_OPTIONS = ['PENDING', 'CONFIRMED', 'FAILED', 'REVERTED'].map((s) => ({ label: s, value: s }));

export default function Transactions() {
  const [data, setData] = useState<TxRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [chain, setChain] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const res: any = await api.getTransactions({ page, limit: 20, chain: chain || undefined, status: status || undefined });
        if (!alive) return;
        setData(res.data);
        setTotalPages(res.totalPages);
      } catch (err: any) {
        if (alive) setError(err?.body?.message ?? 'Could not load transactions.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [page, chain, status]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">Transactions</h1>
        <p className="mt-1 text-sm text-slate-500">Every on-chain send, receive, mint, and burn across all chains.</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={chain} onChange={(v) => { setChain(v); setPage(1); }} options={CHAIN_OPTIONS} placeholder="All chains" />
        <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS} placeholder="All statuses" />
      </div>

      <Card>
        {loading ? (
          <FullPageSpinner />
        ) : error ? (
          <p className="p-6 text-sm text-rose-600">{error}</p>
        ) : data.length === 0 ? (
          <EmptyState title="No transactions found" subtitle="Try a different filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Chain</th>
                  <th className="px-5 py-3 font-medium">From → To</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Tx hash</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.map((tx) => (
                  <tr key={tx.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-ink-800">{tx.type}</td>
                    <td className="px-5 py-3 font-[family-name:var(--font-mono)] text-ink-900">
                      {tx.amount} <span className="text-slate-400">{tx.tokenSymbol}</span>
                    </td>
                    <td className="px-5 py-3 uppercase text-slate-600">{tx.chain}</td>
                    <td className="px-5 py-3 font-[family-name:var(--font-mono)] text-xs text-slate-500">
                      {mono(tx.fromAddress, 6)} → {mono(tx.toAddress, 6)}
                    </td>
                    <td className="px-5 py-3"><Badge label={tx.status} variant={statusVariant(tx.status)} /></td>
                    <td className="px-5 py-3 font-[family-name:var(--font-mono)] text-xs text-slate-500">{mono(tx.txHash, 8)}</td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(tx.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
      </Card>
    </div>
  );
}
