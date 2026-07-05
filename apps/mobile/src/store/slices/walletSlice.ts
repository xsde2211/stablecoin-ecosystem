import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../../services/api';

interface WalletState {
  addresses: Record<string, string> | null;
  balances:  any[];
  transactions: any[];
  loading:   boolean;
  error:     string | null;
  walletReady: boolean;
}

const initialState: WalletState = {
  addresses:   null,
  balances:    [],
  transactions:[],
  loading:     false,
  error:       null,
  walletReady: false,
};

export const fetchAddresses = createAsyncThunk(
  'wallet/addresses',
  () => api.getAddresses()
);

export const fetchBalances = createAsyncThunk(
  'wallet/balances',
  () => api.getBalances()
);

export const fetchTransactions = createAsyncThunk(
  'wallet/transactions',
  ({ page = 1, limit = 20 }: { page?: number; limit?: number }) =>
    api.getTransactions(page, limit)
);

export const createWallet = createAsyncThunk(
  'wallet/create',
  () => api.createWallet()
);

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setWalletReady: (state, action: PayloadAction<boolean>) => {
      state.walletReady = action.payload;
    },
  },
  extraReducers: (builder) => {

    // ── fetchAddresses ────────────────────────────────────────────────────
    // If the user already has wallets on the backend, mark walletReady = true
    // so AppNavigator sends them to the Dashboard instead of WalletSetup.
    builder.addCase(fetchAddresses.fulfilled, (state, action) => {
      const payload = action.payload;
      state.addresses = payload;

      // payload may be an array [{chain,address}] or a Record<chain,address>
      // Either way, if there's at least one address the wallet already exists.
      const hasWallet = Array.isArray(payload)
        ? (payload as any[]).length > 0
        : payload !== null &&
          typeof payload === 'object' &&
          Object.keys(payload).length > 0;

      if (hasWallet) {
        state.walletReady = true;
      }
    });

    // ── fetchBalances ─────────────────────────────────────────────────────
    builder.addCase(fetchBalances.pending, (state) => {
      state.loading = true;
      state.error   = null;
    });
    builder.addCase(fetchBalances.fulfilled, (state, action) => {
      state.loading  = false;
      state.balances = action.payload;
    });
    builder.addCase(fetchBalances.rejected, (state, action) => {
      state.loading = false;
      state.error   = action.error.message ?? 'Error';
    });

    // ── fetchTransactions ─────────────────────────────────────────────────
    builder.addCase(fetchTransactions.fulfilled, (state, action) => {
      state.transactions = action.payload.data ?? action.payload;
    });
  },
});

export const { setWalletReady } = walletSlice.actions;
export default walletSlice.reducer;