import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import * as api from '../lib/api';
import { ApiError } from '../lib/api';
import { Badge, Button, Card, Input, Select } from '../components/ui';

type RegistryContract = { key: string; label: string; roles: string[] };
type Registry = { chains: string[]; contracts: RegistryContract[] };

// TRON addresses are base58check, always start with "T", 34 characters total.
// EVM addresses are 0x + 40 hex chars. Which one is valid depends entirely on
// which chain is selected — validating against a single hardcoded EVM regex
// (as before) meant a correct TRON address could never pass, and the Grant/
// Revoke/Check buttons stayed disabled no matter what you typed.
function isValidAddress(address: string, chain: string): boolean {
  const trimmed = address.trim();
  if (chain === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed);
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed);
}

export default function RoleManagement() {
  const { isSuperAdmin } = useAuth();

  const [registry, setRegistry] = useState<Registry | null>(null);
  const [chain, setChain]       = useState('ethereum');
  const [contract, setContract] = useState('');
  const [role, setRole]         = useState('');
  const [address, setAddress]   = useState('');

  const [busy, setBusy]         = useState<'grant' | 'revoke' | 'check' | null>(null);
  const [error, setError]       = useState('');
  const [result, setResult]     = useState<any>(null);
  const [checkResult, setCheckResult] = useState<{ hasRole: boolean } | null>(null);

  useEffect(() => {
    api.getRoleRegistry().then((r: any) => {
      setRegistry(r);
      if (r.contracts?.[0]) {
        setContract(r.contracts[0].key);
        setRole(r.contracts[0].roles[0]);
      }
    }).catch(() => {});
  }, []);

  if (!isSuperAdmin) {
    return (
      <Card className="p-6">
        <p className="text-sm font-medium text-rose-600">Super Admin only</p>
        <p className="mt-1 text-sm text-slate-500">
          Granting or revoking on-chain roles is restricted to Super Admin accounts — not Admin, not Compliance.
        </p>
      </Card>
    );
  }

  const currentContract = registry?.contracts.find((c) => c.key === contract);
  const roleOptions = currentContract?.roles.map((r) => ({ label: r, value: r })) ?? [];

  const chainOptions = (registry?.chains ?? []).map((c) => ({ label: c.toUpperCase(), value: c }));
  const contractOptions = (registry?.contracts ?? []).map((c) => ({ label: c.label, value: c.key }));

  const canSubmit = !!chain && !!contract && !!role && isValidAddress(address, chain);

  const runCheck = async () => {
    setError(''); setCheckResult(null); setBusy('check');
    try {
      const res = await api.checkRole({ chain, contract, role, address: address.trim() }) as { hasRole: boolean };
      setCheckResult(res);
    } catch (err: any) {
      setError(err instanceof ApiError ? (err.body?.message ?? err.message) : 'Check failed.');
    } finally { setBusy(null); }
  };

  const runGrant = async () => {
    setError(''); setResult(null); setBusy('grant');
    try {
      const res = await api.grantRole({ chain, contract, role, address: address.trim() });
      setResult(res);
      setCheckResult(null);
    } catch (err: any) {
      setError(err instanceof ApiError ? (err.body?.message ?? err.message) : 'Grant failed.');
    } finally { setBusy(null); }
  };

  const runRevoke = async () => {
    setError(''); setResult(null); setBusy('revoke');
    try {
      const res = await api.revokeRole({ chain, contract, role, address: address.trim() });
      setResult(res);
      setCheckResult(null);
    } catch (err: any) {
      setError(err instanceof ApiError ? (err.body?.message ?? err.message) : 'Revoke failed.');
    } finally { setBusy(null); }
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">Role Management</h1>
        <p className="mt-1 text-sm text-slate-500">
          Grant or revoke any on-chain role for any address — the dashboard equivalent of calling{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-[family-name:var(--font-mono)] text-xs">grantRole()</code>{' '}
          from Hardhat console. <span className="font-medium text-amber-600">Super Admin only.</span>
        </p>
      </header>

      <div className="rounded-lg bg-amber-500/10 px-4 py-3 text-xs text-amber-700 mb-6 max-w-2xl">
        In production, only <span className="font-medium">TreasuryTimelock</span> and{' '}
        <span className="font-medium">StablecoinBridgeV2</span> should hold MINTER_ROLE/BURNER_ROLE — granting
        these directly to an EOA (as this tool does) bypasses the multi-sig timelock and is for testing only.
      </div>

      <div className="max-w-xl">
        <Card className="p-6">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Chain</label>
                <Select
                  value={chain}
                  onChange={(v) => { setChain(v); setCheckResult(null); }}
                  options={chainOptions}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Contract</label>
                <Select
                  value={contract}
                  onChange={(v) => {
                    setContract(v);
                    const c = registry?.contracts.find((x) => x.key === v);
                    setRole(c?.roles[0] ?? '');
                    setCheckResult(null);
                  }}
                  options={contractOptions}
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Role</label>
              <Select value={role} onChange={(v) => { setRole(v); setCheckResult(null); }} options={roleOptions} />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Target address</label>
              <Input
                value={address}
                onChange={(e) => { setAddress(e.target.value); setCheckResult(null); }}
                placeholder={chain === 'tron' ? 'TRju3er7y6JWFkmJYhWmLfrfU1yrX3zGV6' : '0x028c268e79a725a8f3ede12d6f2a6cafb6fbcb60'}
                className="font-[family-name:var(--font-mono)] text-xs"
              />
              {address.trim() && !isValidAddress(address, chain) && (
                <p className="mt-1 text-xs text-rose-500">
                  {chain === 'tron' ? 'Not a valid TRON address (must start with T, 34 characters)' : 'Not a valid EVM address (0x + 40 hex characters)'}
                </p>
              )}
            </div>

            {checkResult && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Current status:</span>
                <Badge label={checkResult.hasRole ? 'Has role' : 'Does not have role'} variant={checkResult.hasRole ? 'success' : 'neutral'} />
              </div>
            )}

            {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{error}</p>}

            {result && (
              <div className="rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-700">
                <p className="font-medium">{result.action === 'grant' ? 'Role granted' : 'Role revoked'}</p>
                <p className="mt-1 font-[family-name:var(--font-mono)] break-all">{result.txHash}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="secondary" loading={busy === 'check'} disabled={!canSubmit || !!busy} onClick={runCheck}>
                Check status
              </Button>
              <Button variant="primary" loading={busy === 'grant'} disabled={!canSubmit || !!busy} onClick={runGrant} className="flex-1">
                Grant role
              </Button>
              <Button variant="danger" loading={busy === 'revoke'} disabled={!canSubmit || !!busy} onClick={runRevoke} className="flex-1">
                Revoke role
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}