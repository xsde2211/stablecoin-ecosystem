import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as SecureStore from 'expo-secure-store';
import { api } from '../../services/api';

interface AuthState {
  user:         any | null;
  accessToken:  string | null;
  refreshToken: string | null;
  loading:      boolean;
  error:        string | null;
  hydrated:     boolean;
}

const initialState: AuthState = {
  user: null, accessToken: null, refreshToken: null,
  loading: false, error: null, hydrated: false,
};

export const hydrateAuth = createAsyncThunk('auth/hydrate', async () => {
  const accessToken  = await SecureStore.getItemAsync('accessToken');
  const refreshToken = await SecureStore.getItemAsync('refreshToken');
  if (!accessToken) return null;
  const user = await api.getMe();
  return { accessToken, refreshToken, user };
});

export const loginUser = createAsyncThunk('auth/login', async (creds: { email: string; password: string; totpCode?: string }) => {
  const data = await api.login(creds);
  await SecureStore.setItemAsync('accessToken',  data.accessToken);
  await SecureStore.setItemAsync('refreshToken', data.refreshToken);
  const user = await api.getMe();
  return { ...data, user };
});

export const registerUser = createAsyncThunk('auth/register', async (body: any) => {
  const data = await api.register(body);
  await SecureStore.setItemAsync('accessToken',  data.accessToken);
  await SecureStore.setItemAsync('refreshToken', data.refreshToken);
  const user = await api.getMe();
  return { ...data, user };
});

export const logoutUser = createAsyncThunk('auth/logout', async (_, { getState }) => {
  const state = getState() as any;
  try { await api.logout({ refreshToken: state.auth.refreshToken }); } catch {}
  await SecureStore.deleteItemAsync('accessToken');
  await SecureStore.deleteItemAsync('refreshToken');
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (s) => { s.error = null; },
  },
  extraReducers: (b) => {
    // hydrate
    b.addCase(hydrateAuth.fulfilled, (s, a) => {
      s.hydrated = true;
      if (a.payload) { s.user = a.payload.user; s.accessToken = a.payload.accessToken; s.refreshToken = a.payload.refreshToken; }
    });
    b.addCase(hydrateAuth.rejected, (s) => { s.hydrated = true; });

    // login
    b.addCase(loginUser.pending,   (s) => { s.loading = true;  s.error = null; });
    b.addCase(loginUser.fulfilled, (s, a) => { s.loading=false; s.user=a.payload.user; s.accessToken=a.payload.accessToken; s.refreshToken=a.payload.refreshToken; });
    b.addCase(loginUser.rejected,  (s, a) => { s.loading=false; s.error=a.error.message??'Login failed'; });

    // register
    b.addCase(registerUser.pending,   (s) => { s.loading=true;  s.error=null; });
    b.addCase(registerUser.fulfilled, (s, a) => { s.loading=false; s.user=a.payload.user; s.accessToken=a.payload.accessToken; s.refreshToken=a.payload.refreshToken; });
    b.addCase(registerUser.rejected,  (s, a) => { s.loading=false; s.error=a.error.message??'Registration failed'; });

    // logout
    b.addCase(logoutUser.fulfilled, (s) => { s.user=null; s.accessToken=null; s.refreshToken=null; });
  },
});

export const { clearError } = authSlice.actions;
export default authSlice.reducer;
