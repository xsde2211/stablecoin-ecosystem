import axios, { AxiosInstance } from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.client.interceptors.request.use(async (config) => {
      const token = await SecureStore.getItemAsync('accessToken');
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

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

  // Auth
  register  = (d: any) => this.client.post('/auth/register', d).then(r => r.data);
  login     = (d: any) => this.client.post('/auth/login',    d).then(r => r.data);
  logout    = (d: any) => this.client.post('/auth/logout',   d).then(r => r.data);
  getMe     = ()       => this.client.get('/auth/me').then(r => r.data);
  setup2FA   = ()              => this.client.post('/auth/2fa/setup').then(r => r.data);
  verify2FA  = (token: string) => this.client.post('/auth/2fa/verify', { token }).then(r => r.data);

  // Wallet
  createWallet  = ()    => this.client.post('/wallet/create').then(r => r.data);
  importWallet  = (d: any) => this.client.post('/wallet/import', d).then(r => r.data);
  getAddresses  = ()    => this.client.get('/wallet/addresses').then(r => r.data);
  getBalances   = ()    => this.client.get('/wallet/balances').then(r => r.data);
  sendToken     = (d: any) => this.client.post('/wallet/send', d).then(r => r.data);
  getTransactions = (p=1,l=20) => this.client.get(`/wallet/transactions?page=${p}&limit=${l}`).then(r => r.data);

  // Bridge
  initiateBridge  = (d: any) => this.client.post('/bridge/initiate', d).then(r => r.data);
  getBridgeHistory= ()       => this.client.get('/bridge/history').then(r => r.data);

  // Analytics
  getDashboard = () => this.client.get('/analytics/dashboard').then(r => r.data);

  // KYC
  submitKyc  = (d: any) => this.client.post('/kyc/submit', d).then(r => r.data);
  getKycStatus = ()     => this.client.get('/kyc/status').then(r => r.data);

  // Payments
  createPayment = (d: any) => this.client.post('/payments', d).then(r => r.data);
  getPayment    = (id: string) => this.client.get(`/payments/${id}`).then(r => r.data);
}

export const api = new ApiService();
