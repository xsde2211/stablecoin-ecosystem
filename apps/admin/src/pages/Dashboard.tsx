import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { Card, FullPageSpinner, StatCard } from '../components/ui';

type Stats = {
  users: { total: number; active: number; suspended: number };
  kyc: { approved: number; pending: number };
  merchants: number;
  transactions: number;
  bridgeTransfers: number;
  pendingFraudFlags: number;
  generatedAt: string;
};

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = (await api.getStats()) as Stats;
        if (alive) setStats(data);
      } catch (err: any) {
        if (alive) setError(err?.body?.message ?? 'Could not load system stats.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <FullPageSpinner />;

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          System-wide overview{stats && ` · updated ${new Date(stats.generatedAt).toLocaleTimeString('en-IN')}`}
        </p>
      </header>

      {error && (
        <Card className="mb-6 p-4 text-sm text-rose-600 ring-rose-200">{error}</Card>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total users" value={stats.users.total} sub={`${stats.users.active} active`} />
            <StatCard label="Suspended users" value={stats.users.suspended} accent="rose" />
            <StatCard label="KYC approved" value={stats.kyc.approved} accent="teal" />
            <StatCard label="KYC pending review" value={stats.kyc.pending} accent="amber" />
            <StatCard label="Merchants" value={stats.merchants} accent="sky" />
            <StatCard label="Total transactions" value={stats.transactions} />
            <StatCard label="Bridge transfers" value={stats.bridgeTransfers} accent="sky" />
            <StatCard
              label="Pending fraud flags"
              value={stats.pendingFraudFlags}
              accent={stats.pendingFraudFlags > 0 ? 'rose' : 'teal'}
              sub={stats.pendingFraudFlags > 0 ? 'Needs review' : 'All clear'}
            />
          </div>
        </>
      )}
    </div>
  );
}
