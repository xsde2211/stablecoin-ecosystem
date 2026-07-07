import { useState } from 'react';
import * as api from '../lib/api';
import { ApiError } from '../lib/api';
import { Button, Card, Input, Select } from '../components/ui';

const TOKENS = ['INRX', 'EGOLD', 'ESLVR'].map((t) => ({ label: t, value: t }));
// Direct mint/burn only supports EVM chains in stablecoin-service — TRON isn't wired
// into mintTokens()/burnTokens() there, so it's intentionally left out here too.
const CHAINS = ['ethereum', 'bsc', 'polygon'].map((c) => ({ label: c.toUpperCase(), value: c }));

type Mode = 'mint' | 'burn';

export default function MintBurn() {
  const [mode, setMode]         = useState<Mode>('mint');
  const [token, setToken]       = useState('INRX');
  const [chain, setChain]       = useState('ethereum');
  const [address, setAddress]   = useState('');
  const [amount, setAmount]     = useState('');
  const [reason, setReason]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [result, setResult]     = useState<any>(null);

  const canSubmit = address.trim() && amount.trim() && parseFloat(amount) > 0 && reason.trim();

  const submit = async () => {
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const body = { token, chain, amount: amount.trim(), reason: reason.trim() };
      const res = mode === 'mint'
        ? await api.mintToken({ ...body, toAddress: address.trim() })
        : await api.burnToken({ ...body, fromAddress: address.trim() });
      setResult(res);
    } catch (err: any) {
      setError(err instanceof ApiError ? (err.body?.message ?? err.message) : 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink-900">Mint / Burn</h1>
        <p className="mt-1 text-sm text-slate-500">
          Direct mint and burn to any address — <span className="font-medium text-amber-600">testing only</span>,
          bypasses the treasury multi-sig timelock. Use <span className="font-medium">Treasury</span> for the
          production-safe flow.
        </p>
      </header>

      <div className="max-w-xl">
        <div className="mb-5 flex rounded-lg bg-slate-100 p-1">
          {(['mint', 'burn'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setResult(null); setError(''); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors ${
                mode === m ? 'bg-white text-ink-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <Card className="p-6">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Token</label>
              <Select value={token} onChange={setToken} options={TOKENS} />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Chain</label>
              <Select value={chain} onChange={setChain} options={CHAINS} />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">
                {mode === 'mint' ? 'Recipient address (toAddress)' : 'Source address (fromAddress)'}
              </label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x..."
                className="font-[family-name:var(--font-mono)] text-xs"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Amount</label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100.00" />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Reason (required — recorded in audit log)</label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={mode === 'mint' ? 'e.g. testnet demo top-up' : 'e.g. redeeming test balance'}
              />
            </div>

            {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{error}</p>}

            {result && (
              <div className="rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-700">
                <p className="font-medium">{mode === 'mint' ? 'Minted' : 'Burned'} successfully</p>
                <p className="mt-1 font-[family-name:var(--font-mono)] break-all">{result.txHash}</p>
                <p className="mt-1">Status: {result.status}</p>
              </div>
            )}

            <Button
              className="w-full"
              variant={mode === 'burn' ? 'danger' : 'primary'}
              loading={loading}
              disabled={!canSubmit || loading}
              onClick={submit}
            >
              {loading ? 'Submitting…' : mode === 'mint' ? 'Mint tokens' : 'Burn tokens'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}