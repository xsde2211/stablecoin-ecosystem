import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { api } from '../../services/api';

interface NotifState {
  notifications: any[];
  unread:        number;
  loading:       boolean;
}

const initialState: NotifState = { notifications:[], unread:0, loading:false };

export const fetchNotifications = createAsyncThunk('notif/fetch', () => api.getNotifications());
export const markAllRead        = createAsyncThunk('notif/readAll', () => api.markNotifRead());

const notifSlice = createSlice({
  name: 'notif',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchNotifications.pending,   s => { s.loading = true; });
    b.addCase(fetchNotifications.fulfilled, (s, a) => {
      s.loading       = false;
      s.notifications = a.payload.data ?? [];
      s.unread        = a.payload.unread ?? 0;
    });
    b.addCase(markAllRead.fulfilled, s => { s.unread = 0; });
  },
});

export default notifSlice.reducer;
