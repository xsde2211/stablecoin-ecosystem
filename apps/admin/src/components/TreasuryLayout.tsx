import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function TreasuryLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#f6f7f9]">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 font-[family-name:var(--font-display)] text-sm font-bold text-ink-950">
            e₹
          </div>
          <div>
            <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-ink-900">Treasury</p>
            <p className="text-[11px] text-slate-500">{user?.role === 'GUARDIAN' ? 'Guardian' : 'Signer'} access</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs font-medium text-ink-900">{user?.email}</p>
            <p className="text-[11px] text-slate-400">{user?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-rose-600"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}