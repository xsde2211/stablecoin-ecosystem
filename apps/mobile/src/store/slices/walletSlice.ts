import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { api } from '../../services/api';

interface WalletState {
  addresses:    Record<string, string> | null;
  balances:     any[];
  transactions: any[];
  loading:      boolean;
  error:        string | null;
}

const initialState: WalletState = {
  addresses: null, balances: [], transactions: [],
  loading: false, error: null,
};

export const fetchAddresses    = createAsyncThunk('wallet/addresses',    () => api.getAddresses());
export const fetchBalances     = createAsyncThunk('wallet/balances',     () => api.getBalances());
export const fetchTransactions = createAsyncThunk('wallet/transactions', () => api.getTransactions());
export const createWallet      = createAsyncThunk('wallet/create',       () => api.createWallet());

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchAddresses.fulfilled,    (s, a) => { s.addresses    = a.payload; });
    b.addCase(fetchBalances.fulfilled,     (s, a) => { s.balances     = a.payload; });
    b.addCase(fetchTransactions.fulfilled, (s, a) => { s.transactions = a.payload.data ?? a.payload; });
    b.addCase(fetchBalances.pending,       (s)    => { s.loading      = true; });
    b.addCase(fetchBalances.rejected,      (s, a) => { s.loading=false; s.error=a.error.message??'Error'; });
  },
});

export default walletSlice.reducer;
