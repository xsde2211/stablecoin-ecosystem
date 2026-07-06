import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as api from './api';

type Me = {
  id: string;
  email: string;
  phone: string | null;
  role: 'USER' | 'MERCHANT' | 'COMPLIANCE' | 'ADMIN' | 'SUPER_ADMIN';
  kycStatus: string;
  isActive: boolean;
};

type AuthState = {
  user: Me | null;
  loading: boolean;
  canManage: boolean; // can suspend / change roles — ADMIN & SUPER_ADMIN only
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'COMPLIANCE'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = async () => {
    if (!api.isAuthenticated()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = (await api.getMe()) as Me;
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doLogin = async (email: string, password: string, totpCode?: string) => {
    await api.login(email, password, totpCode);
    await refreshMe();
  };

  const doLogout = () => {
    api.logout();
    setUser(null);
  };

  const value: AuthState = {
    user,
    loading,
    canManage: user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN',
    login: doLogin,
    logout: doLogout,
    refreshMe,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function isAdminRole(role?: string) {
  return !!role && ADMIN_ROLES.includes(role);
}
