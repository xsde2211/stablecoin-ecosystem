const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.message ?? `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

function getAccessToken() {
  return localStorage.getItem('accessToken');
}
function getRefreshToken() {
  return localStorage.getItem('refreshToken');
}
function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
}
function clearTokens() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function request<T = any>(
  method: string,
  path: string,
  opts: { body?: any; query?: Record<string, any>; retry?: boolean } = {},
): Promise<T> {
  const url = new URL(BASE_URL + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const token = getAccessToken();
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !opts.retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(method, path, { ...opts, retry: true });
    clearTokens();
    window.location.href = '/login';
    throw new ApiError(401, { message: 'Session expired' });
  }

  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

// ─── Auth ───────────────────────────────────────────────────────────────────
export async function login(email: string, password: string, totpCode?: string) {
  const data = await request<{ accessToken: string; refreshToken: string }>('POST', '/auth/login', {
    body: { email, password, ...(totpCode ? { totpCode } : {}) },
  });
  setTokens(data.accessToken, data.refreshToken);
  return data;
}

export async function getMe() {
  return request('GET', '/auth/me');
}

export function logout() {
  clearTokens();
}

export function isAuthenticated() {
  return !!getAccessToken();
}

// ─── Admin: Users ───────────────────────────────────────────────────────────
export function getUsers(params: { page?: number; limit?: number; search?: string; kycStatus?: string }) {
  return request('GET', '/admin/users', { query: params });
}
export function getUser(id: string) {
  return request('GET', `/admin/users/${id}`);
}
export function suspendUser(id: string, reason: string) {
  return request('POST', `/admin/users/${id}/suspend`, { body: { reason } });
}
export function unsuspendUser(id: string) {
  return request('POST', `/admin/users/${id}/unsuspend`);
}
export function updateUserRole(id: string, role: string) {
  return request('PATCH', `/admin/users/${id}/role`, { body: { role } });
}

// ─── Admin: Transactions ────────────────────────────────────────────────────
export function getTransactions(params: { page?: number; limit?: number; chain?: string; status?: string }) {
  return request('GET', '/admin/transactions', { query: params });
}

// ─── Admin: Bridge transfers ────────────────────────────────────────────────
export function getBridgeTransfers(params: { page?: number; limit?: number; status?: string }) {
  return request('GET', '/admin/bridge-transfers', { query: params });
}

// ─── Admin: Stats ───────────────────────────────────────────────────────────
export function getStats() {
  return request('GET', '/admin/stats');
}

// ─── Admin: Audit logs ──────────────────────────────────────────────────────
export function getAuditLogs(params: { page?: number; limit?: number; userId?: string; action?: string }) {
  return request('GET', '/admin/audit-logs', { query: params });
}

// ─── Admin: System roles / signers ──────────────────────────────────────────
export function getSystemRoles() {
  return request('GET', '/admin/roles');
}

// ─── Admin: On-chain role management — SUPER_ADMIN only ────────────────────
export function getRoleRegistry() {
  return request('GET', '/admin/roles/registry');
}
export function checkRole(params: { chain: string; contract: string; role: string; address: string }) {
  return request('GET', '/admin/roles/check', { query: params });
}
export function grantRole(body: { chain: string; contract: string; role: string; address: string }) {
  return request('POST', '/admin/roles/grant', { body });
}
export function revokeRole(body: { chain: string; contract: string; role: string; address: string }) {
  return request('POST', '/admin/roles/revoke', { body });
}
export function grantAllRoles(userId: string) {
  return request('POST', `/admin/users/${userId}/grant-all-roles`);
}

// ─── Stablecoin: Mint / Burn (testing only — bypasses treasury timelock) ────
export function mintToken(body: { token: string; chain: string; toAddress: string; amount: string; reason: string }) {
  return request('POST', '/stablecoin/mint', { body });
}
export function burnToken(body: { token: string; chain: string; fromAddress: string; amount: string; reason: string }) {
  return request('POST', '/stablecoin/burn', { body });
}

// ─── Treasury ────────────────────────────────────────────────────────────
export function getTreasuryRequests(status?: string) {
  return request('GET', '/treasury/requests', { query: status ? { status } : undefined });
}
export function getTreasuryRequestDetail(id: string) {
  return request('GET', `/treasury/requests/${id}`);
}
export function approveTreasuryRequest(id: string) {
  return request('POST', `/treasury/requests/${id}/approve`);
}
export function rejectTreasuryRequest(id: string, reason: string) {
  return request('POST', `/treasury/requests/${id}/reject`, { body: { reason } });
}
export function signTreasuryOp(body: { chain: string; opId: string }, signerIndex: number) {
  return request('POST', '/treasury/sign', { query: { signerIndex }, body });
}
export function executeTreasuryOp(chain: string, opId: string) {
  return request('POST', `/treasury/execute/${chain}/${opId}`);
}
export function cancelTreasuryOp(chain: string, opId: string, reason: string) {
  return request('POST', `/treasury/cancel/${chain}/${opId}`, { body: { reason } });
}

export { ApiError };