import axios, { AxiosInstance } from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.100:3001';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Auto-attach token
    this.client.interceptors.request.use(async (config) => {
      try {
        const token = await SecureStore.getItemAsync('accessToken');
        if (token) config.headers.Authorization = `Bearer ${token}`;
      } catch {
        // Corrupted/undecryptable value (e.g. keychain/keystore mismatch after
        // a reinstall) — clear it so we don't keep failing every request,
        // including unrelated calls like login/register's own getMe() check.
        await SecureStore.deleteItemAsync('accessToken').catch(() => {});
        await SecureStore.deleteItemAsync('refreshToken').catch(() => {});
      }
      return config;
    });

    // Auto-refresh on 401
    this.client.interceptors.response.use(
      (res) => res,
      async (err) => {
        if (err.response?.status === 401) {
          try {
            const refresh = await SecureStore.getItemAsync('refreshToken');
            if (refresh) {
              const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken: refresh });
              await SecureStore.setItemAsync('accessToken',  res.data.accessToken);
              await SecureStore.setItemAsync('refreshToken', res.data.refreshToken);
              err.config.headers.Authorization = `Bearer ${res.data.accessToken}`;
              return this.client.request(err.config);
            }
          } catch {
            await SecureStore.deleteItemAsync('accessToken');
            await SecureStore.deleteItemAsync('refreshToken');
          }
        }
        return Promise.reject(err);
      }
    );
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────
  register       = (d: any)  => this.client.post('/auth/register', d).then(r => r.data);
  login          = (d: any)  => this.client.post('/auth/login', d).then(r => r.data);
  logout         = (d: any)  => this.client.post('/auth/logout', d).then(r => r.data);
  getMe          = ()        => this.client.get('/auth/me').then(r => r.data);
  setup2FA       = ()        => this.client.post('/auth/2fa/setup').then(r => r.data);
  verify2FA      = (d: any)  => this.client.post('/auth/2fa/verify', d).then(r => r.data);
  disable2FA     = (d: any)  => this.client.post('/auth/2fa/disable', d).then(r => r.data);
  changePassword = (d: any)  => this.client.post('/auth/change-password', d).then(r => r.data);

  // ─── Wallet ───────────────────────────────────────────────────────────────
  createWallet     = (d?: { label?: string })  => this.client.post('/wallet/create', d ?? {}).then(r => r.data);
  importWallet     = (d: any)                  => this.client.post('/wallet/import', d).then(r => r.data);
  getWallets       = ()                        => this.client.get('/wallet/list').then(r => r.data);
  renameWallet     = (walletIndex: number, label: string) => this.client.patch('/wallet/rename', { walletIndex, label }).then(r => r.data);
  getAddresses     = (walletIndex = 0)         => this.client.get(`/wallet/addresses?walletIndex=${walletIndex}`).then(r => r.data);
  getBalances      = (walletIndex = 0)         => this.client.get(`/wallet/balances?walletIndex=${walletIndex}`).then(r => r.data);
  sendToken        = (d: any)                  => this.client.post('/wallet/send', d).then(r => r.data);
  getTransactions  = (p = 1, l = 20, walletIndex?: number) => {
    const idx = walletIndex !== undefined ? `&walletIndex=${walletIndex}` : '';
    return this.client.get(`/wallet/transactions?page=${p}&limit=${l}${idx}`).then(r => r.data);
  };
  getTransaction   = (id: string)              => this.client.get(`/wallet/transactions/${id}`).then(r => r.data);

  // ─── Bridge ───────────────────────────────────────────────────────────────
  initiateBridge   = (d: any)       => this.client.post('/bridge/initiate', d).then(r => r.data);
  burnBridge       = (d: any)       => this.client.post('/bridge/burn', d).then(r => r.data);
  getBridgeHistory = (p=1)          => this.client.get(`/bridge/history?page=${p}`).then(r => r.data);
  getBridgeTransfer= (id: string)   => this.client.get(`/bridge/transfer/${id}`).then(r => r.data);
  getBridgeStatus  = ()             => this.client.get('/bridge/status').then(r => r.data);

  // ─── Stablecoin ───────────────────────────────────────────────────────────
  getTokenInfo       = (token: string, chain: string) => this.client.get(`/stablecoin/info/${token}/${chain}`).then(r => r.data);
  getAllTokensSupply  = ()           => this.client.get('/stablecoin/supply').then(r => r.data);
  getOraclePrice     = (token: string) => this.client.get(`/stablecoin/oracle/${token}`).then(r => r.data);
  getProofOfReserve  = (token: string, chain: string) => this.client.get(`/stablecoin/reserve/${token}/${chain}`).then(r => r.data);

  // ─── KYC ─────────────────────────────────────────────────────────────────
  submitKyc   = (d: any) => this.client.post('/kyc/submit', d).then(r => r.data);
  getKycStatus= ()       => this.client.get('/kyc/status').then(r => r.data);

  // ─── Payments ─────────────────────────────────────────────────────────────
  createPayment   = (d: any)       => this.client.post('/payments', d).then(r => r.data);
  getPayment      = (id: string)   => this.client.get(`/payments/${id}`).then(r => r.data);
  getPaymentList  = (p=1)          => this.client.get(`/payments?page=${p}`).then(r => r.data);
  cancelPayment   = (id: string)   => this.client.post(`/payments/${id}/cancel`).then(r => r.data);
  getPaymentStats = ()             => this.client.get('/payments/stats/overview').then(r => r.data);

  // ─── Merchant ─────────────────────────────────────────────────────────────
  registerMerchant = (d: any) => this.client.post('/merchant/register', d).then(r => r.data);
  getMerchant      = ()       => this.client.get('/merchant/profile').then(r => r.data);
  updateMerchant   = (d: any) => this.client.patch('/merchant/profile', d).then(r => r.data);
  getMerchantStats = ()       => this.client.get('/merchant/stats').then(r => r.data);

  // ─── Notifications ────────────────────────────────────────────────────────
  getNotifications = (p=1)          => this.client.get(`/notifications?page=${p}`).then(r => r.data);
  markNotifRead    = (id?: string)   => this.client.post(id ? `/notifications/read/${id}` : '/notifications/read').then(r => r.data);
  registerFcm      = (token: string) => this.client.post('/notifications/fcm/register', { token }).then(r => r.data);

  // ─── Analytics ────────────────────────────────────────────────────────────
  getDashboard     = () => this.client.get('/analytics/dashboard').then(r => r.data);
}

export const api = new ApiService();