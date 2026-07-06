import { Fragment, useEffect, useState } from 'react';
import * as api from '../lib/api';
import { Card, EmptyState, FullPageSpinner, Input, Pagination, formatDate, mono } from '../components/ui';

type LogRow = {
  id: string; userId: string | null; action: string; entityType: string;
  entityId: string | null; ipAddress: string | null; payload: any; createdAt: string;
};

export default function AuditLogs() {
  const [data, setData] = useState<LogRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [userId, setUserId] = useState('');
  const [userIdInput, setUserIdInput] = useState('');
  const [action, setAction] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const res: any = await api.getAuditLogs({ page, limit: 50, userId: userId || undefined, action: action || undefined });
        if (!alive) return;
        setData(res.data);
        setTotalPages(res.totalPages);
      } catch (err: any) {
        if (alive) setError(err?.body?.message ?? 'Could not load audit logs.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [page, userId, action]);

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setUserId(userIdInput.trim());
    setAction(actionInput.trim());
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">Audit Logs</h1>
        <p className="mt-1 text-sm text-slate-500">Every sensitive action taken across the platform, for compliance review.</p>
      </header>

      <form onSubmit={applyFilters} className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Filter by user ID…" value={userIdInput} onChange={(e) => setUserIdInput(e.target.value)} className="max-w-[280px]" />
        <Input placeholder="Filter by action (e.g. ADMIN_SUSPEND_USER)…" value={actionInput} onChange={(e) => setActionInput(e.target.value)} className="max-w-[320px]" />
      </form>

      <Card>
        {loading ? (
          <FullPageSpinner />
        ) : error ? (
          <p className="p-6 text-sm text-rose-600">{error}</p>
        ) : data.length === 0 ? (
          <EmptyState title="No audit log entries found" subtitle="Try a different filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Entity</th>
                  <th className="px-5 py-3 font-medium">User ID</th>
                  <th className="px-5 py-3 font-medium">IP</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.map((log) => (
                  <Fragment key={log.id}>
                    <tr
                      className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50"
                      onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    >
                      <td className="px-5 py-3 font-medium text-ink-800">{log.action}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {log.entityType}{log.entityId && <span className="text-slate-400"> · {mono(log.entityId, 8)}</span>}
                      </td>
                      <td className="px-5 py-3 font-[family-name:var(--font-mono)] text-xs text-slate-500">{mono(log.userId, 10) ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-500">{log.ipAddress ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-500">{formatDate(log.createdAt)}</td>
                    </tr>
                    {expanded === log.id && log.payload && (
                      <tr className="border-b border-slate-50 bg-slate-50">
                        <td colSpan={5} className="px-5 py-3">
                          <pre className="max-h-64 overflow-auto rounded-lg bg-ink-950 p-3 font-[family-name:var(--font-mono)] text-xs text-teal-300">
                            {JSON.stringify(log.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
