import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage      from '@react-native-async-storage/async-storage';
import { api } from '../../services/api';

const K_BIO = '@pref_biometric';

interface AuthState {
  user:            any | null;
  accessToken:     string | null;
  refreshToken:    string | null;
  loading:         boolean;
  error:           string | null;
  hydrated:        boolean;
  isAuthenticated: boolean;
  // True when the person is authenticated (valid tokens) but the app is
  // still waiting on a Face ID / fingerprint check before showing wallet
  // data — this is a *device* gate, separate from server-side login/2FA.
  locked:          boolean;
}

const initialState: AuthState = {
  user:            null,
  accessToken:     null,
  refreshToken:    null,
  loading:         false,
  error:           null,
  hydrated:        false,
  isAuthenticated: false,
  locked:          false,
};

// ── hydrateAuth ─────────────────────────────────────────────────────────────
// Called on app start. Restores auth state from SecureStore, then fetches
// the user profile so we know isAuthenticated without re-logging in.
// If the person has turned on biometric login, we also flag that this
// restored session needs a Face ID/fingerprint check before use.
export const hydrateAuth = createAsyncThunk('auth/hydrate', async () => {
  const accessToken  = await SecureStore.getItemAsync('accessToken');
  const refreshToken = await SecureStore.getItemAsync('refreshToken');
  if (!accessToken) return null;
  const user       = await api.getMe();
  const bioPref    = await AsyncStorage.getItem(K_BIO);
  const requiresUnlock = bioPref === 'true';
  return { accessToken, refreshToken, user, requiresUnlock };
});

// ── loginUser ────────────────────────────────────────────────────────────────
export const loginUser = createAsyncThunk(
  'auth/login',
  async (creds: { email: string; password: string; totpCode?: string }, { rejectWithValue }) => {
    try {
      const data = await api.login(creds);
      await SecureStore.setItemAsync('accessToken',  data.accessToken);
      await SecureStore.setItemAsync('refreshToken', data.refreshToken);

      let user = null;
      try {
        user = await api.getMe();
      } catch {
        // non-fatal — profile can be refetched later (e.g. next app hydrate)
      }

      return { ...data, user };
    } catch (err: any) {
      const message = err?.response?.data?.message ?? err?.message ?? 'Login failed';
      return rejectWithValue({ message });
    }
  }
);

// ── registerUser ─────────────────────────────────────────────────────────────
export const registerUser = createAsyncThunk(
  'auth/register',
  async (body: any, { rejectWithValue }) => {
    try {
      const data = await api.register(body);
      await SecureStore.setItemAsync('accessToken',  data.accessToken);
      await SecureStore.setItemAsync('refreshToken', data.refreshToken);

      let user = null;
      try {
        user = await api.getMe();
      } catch {
        // non-fatal — profile can be refetched later (e.g. next app hydrate)
      }

      return { ...data, user };
    } catch (err: any) {
      const message = err?.response?.data?.message ?? err?.message ?? 'Registration failed';
      return rejectWithValue({ message });
    }
  }
);

// ── logoutUser ───────────────────────────────────────────────────────────────
export const logoutUser = createAsyncThunk(
  'auth/logout',
  async (_, { getState }) => {
    const state = getState() as any;
    try { await api.logout({ refreshToken: state.auth.refreshToken }); } catch {}
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => { state.error = null; },
    unlockApp:  (state) => { state.locked = false; },
    // Called when the app comes back from the background — re-arms the
    // Face ID/fingerprint gate if the person has biometric login turned on.
    relockApp:  (state) => { state.locked = true; },
  },
  extraReducers: (builder) => {
    // hydrate
    builder.addCase(hydrateAuth.fulfilled, (state, action) => {
      state.hydrated = true;
      if (action.payload) {
        state.user            = action.payload.user;
        state.accessToken     = action.payload.accessToken;
        state.refreshToken    = action.payload.refreshToken;
        state.isAuthenticated = true;
        state.locked          = !!action.payload.requiresUnlock;
      }
    });
    builder.addCase(hydrateAuth.rejected, (state) => { state.hydrated = true; });

    // login
    builder.addCase(loginUser.pending, (state) => { state.loading = true; state.error = null; });
    builder.addCase(loginUser.fulfilled, (state, action) => {
      state.loading         = false;
      state.user            = action.payload.user ?? action.payload;
      state.accessToken     = action.payload.accessToken;
      state.refreshToken    = action.payload.refreshToken;
      state.isAuthenticated = true;
    });
    builder.addCase(loginUser.rejected, (state, action) => {
      state.loading = false;
      state.error   = (action.payload as any)?.message ?? action.error.message ?? 'Login failed';
    });

    // register
    builder.addCase(registerUser.pending, (state) => { state.loading = true; state.error = null; });
    builder.addCase(registerUser.fulfilled, (state, action) => {
      state.loading         = false;
      state.user            = action.payload.user ?? action.payload;
      state.accessToken     = action.payload.accessToken;
      state.refreshToken    = action.payload.refreshToken;
      state.isAuthenticated = true;
    });
    builder.addCase(registerUser.rejected, (state, action) => {
      state.loading = false;
      state.error   = (action.payload as any)?.message ?? action.error.message ?? 'Registration failed';
    });

    // logout
    builder.addCase(logoutUser.fulfilled, (state) => {
      state.user            = null;
      state.accessToken     = null;
      state.refreshToken    = null;
      state.isAuthenticated = false;
      state.locked          = false;
    });
  },
});

export const { clearError, unlockApp, relockApp } = authSlice.actions;
export const login    = loginUser;
export const register = registerUser;
export const logout   = logoutUser;
export default authSlice.reducer;