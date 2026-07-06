import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import { Badge, Card, EmptyState, FullPageSpinner, Input, Pagination, Select, formatDate, statusVariant } from '../components/ui';

type UserRow = {
  id: string; email: string; phone: string | null; role: string;
  kycStatus: string; isActive: boolean; twoFaEnabled: boolean; createdAt: string;
};

const KYC_OPTIONS = [
  { label: 'Not submitted', value: 'NOT_SUBMITTED' },
  { label: 'Submitted', value: 'SUBMITTED' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
];

export default function Users() {
  const [data, setData] = useState<UserRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [kycStatus, setKycStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const res: any = await api.getUsers({ page, limit: 20, search: search || undefined, kycStatus: kycStatus || undefined });
        if (!alive) return;
        setData(res.data);
        setTotalPages(res.totalPages);
      } catch (err: any) {
        if (alive) setError(err?.body?.message ?? 'Could not load users.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [page, search, kycStatus]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">Users</h1>
        <p className="mt-1 text-sm text-slate-500">Search, filter by KYC status, and manage accounts.</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={submitSearch} className="flex-1 min-w-[220px]">
          <Input
            placeholder="Search by email or phone…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>
        <Select
          value={kycStatus}
          onChange={(v) => { setKycStatus(v); setPage(1); }}
          options={KYC_OPTIONS}
          placeholder="All KYC statuses"
        />
      </div>

      <Card>
        {loading ? (
          <FullPageSpinner />
        ) : error ? (
          <p className="p-6 text-sm text-rose-600">{error}</p>
        ) : data.length === 0 ? (
          <EmptyState title="No users found" subtitle="Try a different search or filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">KYC</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">2FA</th>
                  <th className="px-5 py-3 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link to={`/users/${u.id}`} className="font-medium text-ink-900 hover:text-teal-600">
                        {u.email}
                      </Link>
                      {u.phone && <p className="text-xs text-slate-400">{u.phone}</p>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{u.role}</td>
                    <td className="px-5 py-3"><Badge label={u.kycStatus} variant={statusVariant(u.kycStatus)} /></td>
                    <td className="px-5 py-3">
                      <Badge label={u.isActive ? 'Active' : 'Suspended'} variant={u.isActive ? 'success' : 'error'} />
                    </td>
                    <td className="px-5 py-3 text-slate-500">{u.twoFaEnabled ? 'On' : 'Off'}</td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(u.createdAt)}</td>
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
