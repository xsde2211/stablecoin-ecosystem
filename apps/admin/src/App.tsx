import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth, isAdminRole } from './lib/auth';
import { Layout } from './components/Layout';
import { FullPageSpinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import UserDetail from './pages/UserDetail';
import Transactions from './pages/Transactions';
import BridgeTransfers from './pages/BridgeTransfers';
import AuditLogs from './pages/AuditLogs';
import MintBurn from './pages/MintBurn';
import Roles from './pages/Roles';

function ProtectedShell() {
  const { user, loading, logout } = useAuth();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  if (!isAdminRole(user.role)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ink-950 px-4 text-center">
        <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-white">
          This account can't access the admin console
        </p>
        <p className="max-w-sm text-sm text-slate-400">
          Your role is <span className="font-medium text-slate-300">{user.role}</span>. Only Admin, Super Admin,
          and Compliance accounts can sign in here.
        </p>
        <button
          onClick={() => { logout(); window.location.href = '/login'; }}
          className="mt-2 rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-ink-950"
        >
          Sign out
        </button>
      </div>
    );
  }

  return <Layout />;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (user && isAdminRole(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route element={<ProtectedShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/users" element={<Users />} />
            <Route path="/users/:id" element={<UserDetail />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/bridge-transfers" element={<BridgeTransfers />} />
            <Route path="/mint-burn" element={<MintBurn />} />
            <Route path="/roles" element={<Roles />} />
            <Route path="/audit-logs" element={<AuditLogs />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}