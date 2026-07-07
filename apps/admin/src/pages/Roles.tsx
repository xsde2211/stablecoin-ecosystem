import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { Badge, Card, FullPageSpinner, mono } from '../components/ui';

type AddrRole = { label: string; evm?: string | null; tron?: string | null; note?: string };

type RolesData = {
  deployerGuardian: AddrRole;
  minter: AddrRole;
  burner: AddrRole;
  signersAndValidators: AddrRole[];
  relayer: AddrRole;
  custodianAuditor: AddrRole;
  oracleTeam: AddrRole[];
  complianceOnChain: { blacklister: AddrRole; freezer: AddrRole };
  requiredValidators: string;
  staffUsers: { id: string; email: string; role: string; isActive: boolean; createdAt: string }[];
  generatedAt: string;
};

export default function Roles() {
  const [data, setData]     = useState<RolesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = (await api.getSystemRoles()) as RolesData;
        if (alive) setData(res);
      } catch (err: any) {
        if (alive) setError(err?.body?.message ?? 'Could not load roles.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <FullPageSpinner />;
  if (error || !data) return <Card className="p-6 text-sm text-rose-600">{error}</Card>;

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">Roles & Signers</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every wallet address holding a privileged on-chain role, plus human staff accounts.
          Addresses only — private keys are never exposed here or by the API.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <RoleCard role={data.deployerGuardian} />
        <RoleCard role={data.minter} accent="teal" />
        <RoleCard role={data.burner} accent="rose" />
        <RoleCard role={data.relayer} />
        <RoleCard role={data.custodianAuditor} />
        <RoleCard role={data.complianceOnChain.blacklister} accent="rose" />
        <RoleCard role={data.complianceOnChain.freezer} accent="rose" />
      </div>

      {/* Signers & Validators — grouped list, since it's the same 3 people wearing two hats */}
      <SectionTitle>Bridge Validators & Treasury Signers</SectionTitle>
      <Card className="p-5">
        <p className="mb-4 text-xs text-slate-500">
          Requires <span className="font-medium text-ink-800">{data.requiredValidators}</span> of {data.signersAndValidators.length} signatures
          to approve a bridge mint/unlock or a treasury mint proposal.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {data.signersAndValidators.map((s) => (
            <MiniAddrCard key={s.label} role={s} />
          ))}
        </div>
      </Card>

      {/* Oracle team */}
      <SectionTitle>Oracle Team</SectionTitle>
      <Card className="p-5">
        <p className="mb-4 text-xs text-slate-500">Independently submits live gold/silver prices; the contract takes the median across all active, non-stale submissions.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {data.oracleTeam.map((o) => (
            <MiniAddrCard key={o.label} role={o} />
          ))}
        </div>
      </Card>

      {/* Human staff accounts */}
      <SectionTitle>Staff Accounts (Admin / Compliance)</SectionTitle>
      <Card>
        {data.staffUsers.length === 0 ? (
          <p className="p-5 text-sm text-slate-400">No admin or compliance accounts found.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.staffUsers.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 font-medium text-ink-800">{u.email}</td>
                  <td className="px-5 py-3 text-slate-600">{u.role}</td>
                  <td className="px-5 py-3">
                    <Badge label={u.isActive ? 'Active' : 'Suspended'} variant={u.isActive ? 'success' : 'error'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-900">{children}</h2>;
}

function RoleCard({ role, accent = 'sky' }: { role: AddrRole; accent?: 'teal' | 'rose' | 'sky' }) {
  const dot: Record<string, string> = { teal: 'bg-teal-500', rose: 'bg-rose-500', sky: 'bg-sky-500' };
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot[accent]}`} />
        <p className="text-sm font-semibold text-ink-900">{role.label}</p>
      </div>
      <AddrLines role={role} />
      {role.note && <p className="mt-2 text-xs text-slate-400">{role.note}</p>}
    </Card>
  );
}

function MiniAddrCard({ role }: { role: AddrRole }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
      <p className="mb-2 text-xs font-semibold text-ink-800">{role.label}</p>
      <AddrLines role={role} compact />
    </div>
  );
}

function AddrLines({ role, compact = false }: { role: AddrRole; compact?: boolean }) {
  const size = compact ? 'text-[11px]' : 'text-xs';
  return (
    <div className="space-y-1">
      {role.evm && (
        <div className={`flex items-center gap-2 ${size}`}>
          <span className="w-10 shrink-0 font-medium text-slate-400">EVM</span>
          <span className="font-[family-name:var(--font-mono)] text-slate-600">{mono(role.evm, 14)}</span>
        </div>
      )}
      {role.tron && (
        <div className={`flex items-center gap-2 ${size}`}>
          <span className="w-10 shrink-0 font-medium text-slate-400">TRON</span>
          <span className="font-[family-name:var(--font-mono)] text-slate-600">{mono(role.tron, 14)}</span>
        </div>
      )}
      {!role.evm && !role.tron && <p className="text-xs italic text-slate-400">Not configured</p>}
    </div>
  );
}