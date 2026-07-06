import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { Badge, Card, EmptyState, FullPageSpinner, Pagination, Select, formatDate, statusVariant } from '../components/ui';

type BridgeRow = {
  id: string; srcChain: string; dstChain: string; srcAddress: string; dstAddress: string;
  srcTxHash: string | null; dstTxHash: string | null; amount: string; token: string;
  status: string; type: string; confirmations: number; createdAt: string;
  user: { email: string };
};

const STATUS_OPTIONS = ['PENDING', 'LOCKED', 'COMPLETED', 'FAILED'].map((s) => ({ label: s, value: s }));

export default function BridgeTransfers() {
  const [data, setData] = useState<BridgeRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const res: any = await api.getBridgeTransfers({ page, limit: 20, status: status || undefined });
        if (!alive) return;
        setData(res.data);
        setTotalPages(res.totalPages);
      } catch (err: any) {
        if (alive) setError(err?.body?.message ?? 'Could not load bridge transfers.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [page, status]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">Bridge Transfers</h1>
        <p className="mt-1 text-sm text-slate-500">Cross-chain lock/mint and burn/unlock transfers.</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS} placeholder="All statuses" />
      </div>

      <Card>
        {loading ? (
          <FullPageSpinner />
        ) : error ? (
          <p className="p-6 text-sm text-rose-600">{error}</p>
        ) : data.length === 0 ? (
          <EmptyState title="No bridge transfers found" subtitle="Try a different filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Route</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Confirmations</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-ink-800">{b.user?.email ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">
                      <span className="uppercase">{b.srcChain}</span>
                      <span className="mx-1.5 text-slate-300">→</span>
                      <span className="uppercase">{b.dstChain}</span>
                    </td>
                    <td className="px-5 py-3 font-[family-name:var(--font-mono)] text-ink-900">
                      {b.amount} <span className="text-slate-400">{b.token}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{b.type.replace('_', ' → ')}</td>
                    <td className="px-5 py-3"><Badge label={b.status} variant={statusVariant(b.status)} /></td>
                    <td className="px-5 py-3 text-slate-500">{b.confirmations}</td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(b.createdAt)}</td>
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
