import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, isAdminRole } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Button, Input, Spinner } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password, needsTotp ? totpCode : undefined);
      navigate('/', { replace: true });
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401 && /2FA code required/i.test(err.body?.message ?? '')) {
        setNeedsTotp(true);
        setError('Enter the 6-digit code from your authenticator app.');
      } else {
        setError(err?.body?.message ?? err?.message ?? 'Login failed. Check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500 font-[family-name:var(--font-display)] text-lg font-bold text-ink-950">
            e₹
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-white">Admin Control Center</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in with your operator credentials</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/5">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Email</label>
              <Input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                disabled={needsTotp}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Password</label>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={needsTotp}
              />
            </div>

            {needsTotp && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">2FA code</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="tracking-[0.4em] text-center font-[family-name:var(--font-mono)]"
                />
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{error}</p>
            )}

            <Button type="submit" className="w-full" loading={loading} disabled={loading}>
              {loading ? 'Signing in…' : needsTotp ? 'Verify & sign in' : 'Sign in'}
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Access is restricted to Admin, Super Admin, and Compliance roles.
        </p>
      </div>
    </div>
  );
}

// Helper kept out of the way — exported so ProtectedRoute can reuse logic
export { isAdminRole };
export function LoadingDot() {
  return <Spinner size={14} />;
}
