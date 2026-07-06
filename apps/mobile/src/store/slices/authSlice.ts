import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as SecureStore from 'expo-secure-store';
import { api } from '../../services/api';

interface AuthState {
  user:            any | null;
  accessToken:     string | null;
  refreshToken:    string | null;
  loading:         boolean;
  error:           string | null;
  hydrated:        boolean;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  user:            null,
  accessToken:     null,
  refreshToken:    null,
  loading:         false,
  error:           null,
  hydrated:        false,
  isAuthenticated: false,
};

// ── hydrateAuth ─────────────────────────────────────────────────────────────
// Called on app start. Restores auth state from SecureStore, then fetches
// the user profile so we know isAuthenticated without re-logging in.
export const hydrateAuth = createAsyncThunk('auth/hydrate', async () => {
  const accessToken  = await SecureStore.getItemAsync('accessToken');
  const refreshToken = await SecureStore.getItemAsync('refreshToken');
  if (!accessToken) return null;
  const user = await api.getMe();
  return { accessToken, refreshToken, user };
});

// ── loginUser ────────────────────────────────────────────────────────────────
export const loginUser = createAsyncThunk(
  'auth/login',
  async (creds: { email: string; password: string; totpCode?: string }) => {
    const data = await api.login(creds);
    await SecureStore.setItemAsync('accessToken',  data.accessToken);
    await SecureStore.setItemAsync('refreshToken', data.refreshToken);

    // Login itself succeeded and tokens are already stored — don't let a
    // flaky/failed profile fetch turn a successful login into a rejected
    // thunk. That would leave isAuthenticated false and strand the user on
    // the login screen even though they're holding valid tokens, since
    // nothing downstream (AppNavigator) would ever see them as logged in.
    let user = null;
    try {
      user = await api.getMe();
    } catch {
      // non-fatal — profile can be refetched later (e.g. next app hydrate)
    }

    return { ...data, user };
  }
);

// ── registerUser ─────────────────────────────────────────────────────────────
export const registerUser = createAsyncThunk(
  'auth/register',
  async (body: any) => {
    const data = await api.register(body);
    await SecureStore.setItemAsync('accessToken',  data.accessToken);
    await SecureStore.setItemAsync('refreshToken', data.refreshToken);

    // Same reasoning as loginUser above — registration + token storage
    // already succeeded by this point; a getMe() hiccup shouldn't discard that.
    let user = null;
    try {
      user = await api.getMe();
    } catch {
      // non-fatal — profile can be refetched later (e.g. next app hydrate)
    }

    return { ...data, user };
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
      state.error   = action.error.message ?? 'Login failed';
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
      state.error   = action.error.message ?? 'Registration failed';
    });

    // logout
    builder.addCase(logoutUser.fulfilled, (state) => {
      state.user            = null;
      state.accessToken     = null;
      state.refreshToken    = null;
      state.isAuthenticated = false;
    });
  },
});

export const { clearError } = authSlice.actions;
export const login    = loginUser;
export const register = registerUser;
export const logout   = logoutUser;
export default authSlice.reducer;