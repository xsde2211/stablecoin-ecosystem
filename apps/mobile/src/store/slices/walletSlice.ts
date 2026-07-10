import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../services/api';
import type { RootState } from '../index';

// Persisted key for which wallet (of possibly many) is currently active.
// This used to live ONLY as local component state inside WalletManagerScreen,
// which is why switching wallets there never affected Dashboard / Send /
// Receive / TokenDetail — they had no way to know the index had changed.
export const K_ACTIVE_IDX = '@active_wallet_index';

interface WalletState {
  addresses: Record<string, string> | null;
  balances:  any[];
  transactions: any[];
  loading:   boolean;
  error:     string | null;
  walletReady: boolean;
  // Single source of truth for "which wallet is currently selected".
  // Every screen reads this from Redux instead of assuming walletIndex 0.
  activeWalletIndex: number;
}

const initialState: WalletState = {
  addresses:   null,
  balances:    [],
  transactions:[],
  loading:     false,
  error:       null,
  walletReady: false,
  activeWalletIndex: 0,
};

// ── Restore the persisted active wallet index ────────────────────────────────
// Call this once at app startup (before the first fetchAddresses/fetchBalances)
// so we resume on whichever wallet the user last switched to.
export const initActiveWalletIndex = createAsyncThunk(
  'wallet/initActiveWalletIndex',
  async () => {
    try {
      const raw = await AsyncStorage.getItem(K_ACTIVE_IDX);
      return raw ? parseInt(raw, 10) : 0;
    } catch {
      return 0;
    }
  }
);

// ── Data fetchers ─────────────────────────────────────────────────────────────
// All three now accept an explicit walletIndex, falling back to the
// currently active wallet in the store when the caller doesn't pass one.
// This is what actually makes every screen (Dashboard, Send, Receive,
// TokenDetail, Bridge, ...) reflect whichever wallet is active.
export const fetchAddresses = createAsyncThunk(
  'wallet/addresses',
  // `number | void` (not `| undefined`) is what makes RTK's generated action
  // creator accept zero arguments — dispatch(fetchAddresses()) — instead of
  // demanding you pass `undefined` explicitly.
  (walletIndex: number | void, thunkAPI) => {
    // Cast after `??`: TS doesn't narrow `void` away the same way it narrows
    // `undefined` away, so without this cast `idx` stays typed
    // `number | void` and errors when passed into api.getAddresses(idx).
    const idx = (walletIndex ?? (thunkAPI.getState() as RootState).wallet.activeWalletIndex) as number;
    return api.getAddresses(idx);
  }
);

export const fetchBalances = createAsyncThunk(
  'wallet/balances',
  (walletIndex: number | void, thunkAPI) => {
    const idx = (walletIndex ?? (thunkAPI.getState() as RootState).wallet.activeWalletIndex) as number;
    return api.getBalances(idx);
  }
);

export const fetchTransactions = createAsyncThunk(
  'wallet/transactions',
  (
    { page = 1, limit = 20, walletIndex }: { page?: number; limit?: number; walletIndex?: number },
    thunkAPI
  ) => {
    const idx = walletIndex ?? (thunkAPI.getState() as RootState).wallet.activeWalletIndex;
    return api.getTransactions(page, limit, idx);
  }
);

export const createWallet = createAsyncThunk(
  'wallet/create',
  () => api.createWallet()
);

// ── Switch the active wallet app-wide ─────────────────────────────────────────
// Persists the new index to AsyncStorage, updates Redux (so every connected
// screen re-renders), and immediately refreshes addresses/balances/
// transactions for the newly active wallet. Dispatch this from
// WalletManagerScreen (or anywhere else) instead of writing to AsyncStorage
// directly — that's what was missing before.
export const switchActiveWallet = createAsyncThunk(
  'wallet/switchActive',
  async (walletIndex: number, thunkAPI) => {
    await AsyncStorage.setItem(K_ACTIVE_IDX, String(walletIndex));
    thunkAPI.dispatch(setActiveWalletIndex(walletIndex));
    await Promise.all([
      thunkAPI.dispatch(fetchAddresses(walletIndex)),
      thunkAPI.dispatch(fetchBalances(walletIndex)),
      thunkAPI.dispatch(fetchTransactions({ page: 1, limit: 20, walletIndex })),
    ]);
    return walletIndex;
  }
);

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setWalletReady: (state, action: PayloadAction<boolean>) => {
      state.walletReady = action.payload;
    },
    setActiveWalletIndex: (state, action: PayloadAction<number>) => {
      state.activeWalletIndex = action.payload;
    },
  },
  extraReducers: (builder) => {

    builder.addCase(initActiveWalletIndex.fulfilled, (state, action) => {
      state.activeWalletIndex = action.payload;
    });

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

export const { setWalletReady, setActiveWalletIndex } = walletSlice.actions;
export default walletSlice.reducer;