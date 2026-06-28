import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../../services/api';

interface WalletState {
  addresses: Record<string, string> | null;
  balances: any[];
  transactions: any[];
  loading: boolean;
  error: string | null;
  walletReady: boolean;
}

const initialState: WalletState = {
  addresses: null,
  balances: [],
  transactions: [],
  loading: false,
  error: null,
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
    builder.addCase(fetchAddresses.fulfilled, (state, action) => {
      state.addresses = action.payload;
    });

    builder.addCase(fetchBalances.fulfilled, (state, action) => {
      state.loading = false;
      state.balances = action.payload;
    });

    builder.addCase(fetchTransactions.fulfilled, (state, action) => {
      state.transactions = action.payload.data ?? action.payload;
    });

    builder.addCase(fetchBalances.pending, (state) => {
      state.loading = true;
      state.error = null;
    });

    builder.addCase(fetchBalances.rejected, (state, action) => {
      state.loading = false;
      state.error = action.error.message ?? 'Error';
    });
  },
});

export const { setWalletReady } = walletSlice.actions;

export default walletSlice.reducer;