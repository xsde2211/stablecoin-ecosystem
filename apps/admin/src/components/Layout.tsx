import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Dashboard', icon: DashboardIcon, end: true },
  { to: '/users', label: 'Users', icon: UsersIcon },
  { to: '/transactions', label: 'Transactions', icon: TxIcon },
  { to: '/bridge-transfers', label: 'Bridge Transfers', icon: BridgeIcon },
  { to: '/treasury', label: 'Treasury', icon: TreasuryIcon },
  { to: '/mint-burn', label: 'Mint / Burn', icon: MintBurnIcon },
  { to: '/roles', label: 'Roles & Signers', icon: RolesIcon },
  { to: '/role-management', label: 'Role Management', icon: RoleManagementIcon, superAdminOnly: true },
  { to: '/audit-logs', label: 'Audit Logs', icon: LogIcon },
];

export function Layout() {
  const { user, logout, isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const visibleNav = NAV.filter((item) => !item.superAdminOnly || isSuperAdmin);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f6f7f9]">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col bg-ink-950 text-slate-300">
        <div className="flex items-center gap-2.5 px-6 py-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 font-[family-name:var(--font-display)] text-sm font-bold text-ink-950">
            e₹
          </div>
          <div>
            <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-white">Stablecoin Admin</p>
            <p className="text-[11px] text-slate-500">Control Center</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-ink-800 text-white ring-1 ring-inset ring-teal-500/30'
                    : 'text-slate-400 hover:bg-ink-900 hover:text-slate-200'
                }`
              }
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-800 px-4 py-4">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-700 text-xs font-semibold text-teal-400">
              {(user?.email ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-white">{user?.email}</p>
              <p className="text-[11px] text-slate-500">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-2 w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-400 transition-colors hover:bg-ink-900 hover:text-rose-400"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

// ─── Icons (inline, no icon-package dependency) ─────────────────────────────
function DashboardIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}
function UsersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <circle cx="17.5" cy="8.5" r="2.3" /><path d="M15.7 14.2c2.8.3 5.3 2.3 5.3 5.8" />
    </svg>
  );
}
function TxIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h13l-3-3M20 17H7l3 3" />
    </svg>
  );
}
function BridgeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 17c2-4 4-6 9-6s7 2 9 6M3 17v3M21 17v3M7 11V7M17 11V7" />
    </svg>
  );
}
function LogIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 3h9l3 3v15H6z" /><path d="M9 10h6M9 14h6M9 18h4" />
    </svg>
  );
}
function TreasuryIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="8" width="18" height="12" rx="1.5" />
      <path d="M3 8l9-5 9 5M8 12v4M12 12v4M16 12v4" />
    </svg>
  );
}
function MintBurnIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="8" cy="8" r="5" /><path d="M13 13c3 .5 5 2.5 5 5.5M8 5v6M5 8h6" />
      <path d="M19 15l1.5 1.5L19 18M22 16.5h-4.5" />
    </svg>
  );
}
function RolesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 2l7 3v6c0 5-3 8.5-7 11-4-2.5-7-6-7-11V5z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function RoleManagementIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 15a4 4 0 100-8 4 4 0 000 8z" />
      <path d="M19.4 13a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V19a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 13a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 7a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 008.9 2.6a1.65 1.65 0 001-1.51V1a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 7a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}