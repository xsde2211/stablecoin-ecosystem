import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import * as api from '../lib/api';
import { ApiError } from '../lib/api';
import { Badge, Button, Card, EmptyState, FullPageSpinner, Input, Modal, formatDate, mono } from '../components/ui';

type TreasuryRequest = {
  id: string; chain: string; token: string; opType: string; amount: string; reason: string;
  targetAddress: string | null; status: string; treasuryOpId: string | null;
  rejectedReason: string | null; createdAt: string;
  user: { email: string };
};

const STATUS_VARIANT: Record<string, any> = {
  PENDING_REVIEW: 'warning', PROPOSED: 'info', REJECTED: 'error',
};

export default function TreasuryDashboard() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<TreasuryRequest[]>([]);
  const [filter, setFilter] = useState<'PENDING_REVIEW' | 'PROPOSED' | 'REJECTED' | ''>('PENDING_REVIEW');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const signerIndex = (user as any)?.signerIndex ?? 1;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res: any = await api.getTreasuryRequests(filter || undefined);
      setRequests(Array.isArray(res) ? res : []);
    } catch (err: any) {
      setError(err?.body?.message ?? 'Could not load requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const openDetail = async (id: string) => {
    setActionError('');
    try {
      const res = await api.getTreasuryRequestDetail(id);
      setDetail(res);
    } catch (err: any) {
      setActionError(err?.body?.message ?? 'Could not load detail.');
    }
  };

  const handleApprove = async (id: string) => {
    setBusy(true); setActionError('');
    try {
      await api.approveTreasuryRequest(id);
      setDetail(null);
      await load();
    } catch (err: any) {
      setActionError(err instanceof ApiError ? (err.body?.message ?? err.message) : 'Approve failed.');
    } finally { setBusy(false); }
  };

  const handleReject = async () => {
    if (!detail || !rejectReason.trim()) return;
    setBusy(true); setActionError('');
    try {
      await api.rejectTreasuryRequest(detail.id, rejectReason.trim());
      setRejectOpen(false); setRejectReason(''); setDetail(null);
      await load();
    } catch (err: any) {
      setActionError(err?.body?.message ?? 'Reject failed.');
    } finally { setBusy(false); }
  };

  const handleSign = async () => {
    if (!detail?.treasuryOpId) return;
    setBusy(true); setActionError('');
    try {
      await api.signTreasuryOp({ chain: detail.chain, opId: detail.treasuryOpId }, signerIndex);
      await openDetail(detail.id);
    } catch (err: any) {
      setActionError(err instanceof ApiError ? (err.body?.message ?? err.message) : 'Sign failed.');
    } finally { setBusy(false); }
  };

  const handleExecute = async () => {
    if (!detail?.treasuryOpId) return;
    setBusy(true); setActionError('');
    try {
      await api.executeTreasuryOp(detail.chain, detail.treasuryOpId);
      await openDetail(detail.id);
      await load();
    } catch (err: any) {
      setActionError(err instanceof ApiError ? (err.body?.message ?? err.message) : 'Execute failed — the 12h timelock may not have passed yet.');
    } finally { setBusy(false); }
  };

  const handleCancel = async () => {
    if (!detail?.treasuryOpId || !cancelReason.trim()) return;
    setBusy(true); setActionError('');
    try {
      await api.cancelTreasuryOp(detail.chain, detail.treasuryOpId, cancelReason.trim());
      setCancelOpen(false); setCancelReason(''); setDetail(null);
      await load();
    } catch (err: any) {
      setActionError(err instanceof ApiError ? (err.body?.message ?? err.message) : 'Cancel failed (Guardian role required on-chain).');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">Treasury</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review mint/burn requests, then sign, execute, or cancel the resulting on-chain operations.
        </p>
      </header>

      <div className="mb-4 flex gap-2">
        {(['PENDING_REVIEW', 'PROPOSED', 'REJECTED', ''] as const).map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === s ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {s === '' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <Card>
        {loading ? (
          <FullPageSpinner />
        ) : error ? (
          <p className="p-6 text-sm text-rose-600">{error}</p>
        ) : requests.length === 0 ? (
          <EmptyState title="No requests" subtitle="Mint/burn requests submitted from the mobile app will show up here." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Request</th>
                <th className="px-5 py-3 font-medium">Chain</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50" onClick={() => openDetail(r.id)}>
                  <td className="px-5 py-3 font-medium text-ink-800">{r.user?.email}</td>
                  <td className="px-5 py-3 text-ink-900">{r.opType} {r.amount} {r.token}</td>
                  <td className="px-5 py-3 uppercase text-slate-600">{r.chain}</td>
                  <td className="px-5 py-3"><Badge label={r.status.replace('_', ' ')} variant={STATUS_VARIANT[r.status]} /></td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Request detail">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Requested by</span><span className="font-medium">{detail.user?.email}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Operation</span><span className="font-medium">{detail.opType} {detail.amount} {detail.token}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Chain</span><span className="font-medium uppercase">{detail.chain}</span></div>
            <div><span className="text-slate-500">Reason</span><p className="mt-1 rounded-lg bg-slate-50 p-3 text-slate-700">{detail.reason}</p></div>
            {detail.targetAddress && (
              <div className="flex justify-between">
                <span className="text-slate-500">Target</span>
                <span className="font-[family-name:var(--font-mono)] text-xs">{mono(detail.targetAddress, 14)}</span>
              </div>
            )}
            <div className="flex justify-between"><span className="text-slate-500">Status</span><Badge label={detail.status.replace('_', ' ')} variant={STATUS_VARIANT[detail.status]} /></div>

            {detail.onChain && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold text-ink-800">On-chain status</p>
                <div className="space-y-1 text-xs text-slate-600">
                  <p>Approvals: {detail.onChain.approvals ?? '—'}</p>
                  <p>Op status: {detail.onChain.status ?? '—'}</p>
                  {detail.onChain.executeAfter && <p>Executable after: {formatDate(detail.onChain.executeAfter)}</p>}
                  {detail.onChain.canExecuteNow && <p className="font-medium text-teal-600">Ready to execute</p>}
                </div>
              </div>
            )}

            {actionError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{actionError}</p>}

            <div className="flex flex-wrap gap-2 pt-2">
              {detail.status === 'PENDING_REVIEW' && (
                <>
                  <Button size="sm" loading={busy} onClick={() => handleApprove(detail.id)}>Approve → propose on-chain</Button>
                  <Button size="sm" variant="danger" onClick={() => setRejectOpen(true)}>Reject</Button>
                </>
              )}
              {detail.status === 'PROPOSED' && (
                <>
                  <Button size="sm" variant="secondary" loading={busy} onClick={handleSign}>Sign</Button>
                  <Button size="sm" variant="primary" loading={busy} onClick={handleExecute}>Execute</Button>
                  <Button size="sm" variant="danger" onClick={() => setCancelOpen(true)}>Cancel (Guardian)</Button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject request">
        <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason for rejection…" autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button variant="danger" size="sm" loading={busy} disabled={!rejectReason.trim()} onClick={handleReject}>Reject request</Button>
        </div>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel on-chain operation">
        <p className="mb-3 text-sm text-slate-600">This requires the Guardian role on-chain. Provide a reason for the audit log.</p>
        <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason for cancellation…" autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setCancelOpen(false)}>Back</Button>
          <Button variant="danger" size="sm" loading={busy} disabled={!cancelReason.trim()} onClick={handleCancel}>Cancel operation</Button>
        </div>
      </Modal>
    </div>
  );
}