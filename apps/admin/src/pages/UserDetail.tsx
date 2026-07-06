import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as api from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Badge, Button, Card, FullPageSpinner, Input, Modal, Select, formatDate, mono, statusVariant,
} from '../components/ui';

type UserDetail = {
  id: string; email: string; phone: string | null; role: string;
  kycStatus: string; isActive: boolean; twoFaEnabled: boolean; createdAt: string;
  wallets: { chain: string; address: string }[];
  kycApplications: { id: string; status: string; documentType: string; provider: string; createdAt: string; rejectedReason?: string | null }[];
  transactionCount: number;
  fraudFlagCount: number;
};

const ROLE_OPTIONS = [
  { label: 'User', value: 'USER' },
  { label: 'Merchant', value: 'MERCHANT' },
  { label: 'Compliance', value: 'COMPLIANCE' },
  { label: 'Admin', value: 'ADMIN' },
  { label: 'Super Admin', value: 'SUPER_ADMIN' },
];

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canManage } = useAuth();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendLoading, setSuspendLoading] = useState(false);

  const [roleOpen, setRoleOpen] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [roleLoading, setRoleLoading] = useState(false);

  const [unsuspendLoading, setUnsuspendLoading] = useState(false);

  const load = async () => {
    if (!id) return;
    try {
      const data = (await api.getUser(id)) as UserDetail;
      setUser(data);
      setNewRole(data.role);
    } catch (err: any) {
      setError(err?.body?.message ?? 'Could not load user.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const handleSuspend = async () => {
    if (!id || !suspendReason.trim()) return;
    setSuspendLoading(true);
    setActionError('');
    try {
      await api.suspendUser(id, suspendReason.trim());
      setSuspendOpen(false);
      setSuspendReason('');
      await load();
    } catch (err: any) {
      setActionError(err?.body?.message ?? 'Could not suspend user.');
    } finally {
      setSuspendLoading(false);
    }
  };

  const handleUnsuspend = async () => {
    if (!id) return;
    setUnsuspendLoading(true);
    setActionError('');
    try {
      await api.unsuspendUser(id);
      await load();
    } catch (err: any) {
      setActionError(err?.body?.message ?? 'Could not unsuspend user.');
    } finally {
      setUnsuspendLoading(false);
    }
  };

  const handleRoleChange = async () => {
    if (!id || !newRole) return;
    setRoleLoading(true);
    setActionError('');
    try {
      await api.updateUserRole(id, newRole);
      setRoleOpen(false);
      await load();
    } catch (err: any) {
      setActionError(err?.body?.message ?? 'Could not update role.');
    } finally {
      setRoleLoading(false);
    }
  };

  if (loading) return <FullPageSpinner />;
  if (error || !user) {
    return (
      <div>
        <button onClick={() => navigate(-1)} className="mb-4 text-sm text-slate-500 hover:text-ink-900">← Back</button>
        <Card className="p-6 text-sm text-rose-600">{error ?? 'User not found.'}</Card>
      </div>
    );
  }

  return (
    <div>
      <Link to="/users" className="mb-4 inline-block text-sm text-slate-500 hover:text-ink-900">← All users</Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">{user.email}</h1>
          <p className="mt-1 text-sm text-slate-500">{user.phone ?? 'No phone on file'} · Joined {formatDate(user.createdAt)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge label={user.role} variant="info" />
            <Badge label={user.kycStatus} variant={statusVariant(user.kycStatus)} />
            <Badge label={user.isActive ? 'Active' : 'Suspended'} variant={user.isActive ? 'success' : 'error'} />
            <Badge label={user.twoFaEnabled ? '2FA on' : '2FA off'} variant={user.twoFaEnabled ? 'success' : 'neutral'} />
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => { setNewRole(user.role); setRoleOpen(true); }}>
              Change role
            </Button>
            {user.isActive ? (
              <Button variant="danger" size="sm" onClick={() => setSuspendOpen(true)}>Suspend</Button>
            ) : (
              <Button variant="primary" size="sm" loading={unsuspendLoading} onClick={handleUnsuspend}>Unsuspend</Button>
            )}
          </div>
        )}
      </header>

      {actionError && <Card className="mb-6 p-4 text-sm text-rose-600 ring-rose-200">{actionError}</Card>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Transactions</p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">{user.transactionCount}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Fraud flags</p>
          <p className={`mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold ${user.fraudFlagCount > 0 ? 'text-rose-600' : 'text-ink-900'}`}>
            {user.fraudFlagCount}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Wallets</p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">{user.wallets.length}</p>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-ink-900">Wallets</h2>
          </div>
          {user.wallets.length === 0 ? (
            <p className="p-5 text-sm text-slate-400">No wallets created yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {user.wallets.map((w) => (
                <li key={w.chain} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm font-medium capitalize text-ink-800">{w.chain}</span>
                  <span className="font-[family-name:var(--font-mono)] text-xs text-slate-500">{mono(w.address, 12)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-ink-900">KYC history</h2>
          </div>
          {user.kycApplications.length === 0 ? (
            <p className="p-5 text-sm text-slate-400">No KYC submissions yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {user.kycApplications.map((k) => (
                <li key={k.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-ink-800">{k.documentType}</span>
                    <Badge label={k.status} variant={statusVariant(k.status)} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{k.provider} · {formatDate(k.createdAt)}</p>
                  {k.rejectedReason && <p className="mt-1 text-xs text-rose-500">Reason: {k.rejectedReason}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Suspend modal */}
      <Modal open={suspendOpen} onClose={() => setSuspendOpen(false)} title="Suspend user">
        <p className="mb-3 text-sm text-slate-600">
          This immediately blocks <span className="font-medium">{user.email}</span> from logging in. Provide a reason for the audit log.
        </p>
        <Input
          value={suspendReason}
          onChange={(e) => setSuspendReason(e.target.value)}
          placeholder="Reason for suspension…"
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setSuspendOpen(false)}>Cancel</Button>
          <Button variant="danger" size="sm" loading={suspendLoading} disabled={!suspendReason.trim()} onClick={handleSuspend}>
            Suspend user
          </Button>
        </div>
      </Modal>

      {/* Role modal */}
      <Modal open={roleOpen} onClose={() => setRoleOpen(false)} title="Change role">
        <p className="mb-3 text-sm text-slate-600">
          Current role: <span className="font-medium">{user.role}</span>
        </p>
        <Select value={newRole} onChange={setNewRole} options={ROLE_OPTIONS} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRoleOpen(false)}>Cancel</Button>
          <Button size="sm" loading={roleLoading} disabled={newRole === user.role} onClick={handleRoleChange}>
            Update role
          </Button>
        </div>
      </Modal>
    </div>
  );
}
