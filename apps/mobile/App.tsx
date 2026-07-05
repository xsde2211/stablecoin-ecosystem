import 'react-native-get-random-values';
import { Buffer } from 'buffer';
global.Buffer = Buffer;

import React, { useEffect } from 'react';
import { StatusBar }          from 'expo-status-bar';
import { SafeAreaProvider }   from 'react-native-safe-area-context';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { store }              from './src/store';
import type { AppDispatch, RootState } from './src/store';
import AppNavigator           from './src/navigation/AppNavigator';
import { hydrateAuth }        from './src/store/slices/authSlice';
import { fetchAddresses }     from './src/store/slices/walletSlice';

// Inner component so it can access the Redux store via hooks
function AppInner() {
  const dispatch            = useDispatch<AppDispatch>();
  const { isAuthenticated } = useSelector((s: RootState) => s.auth);

  // On mount: restore auth tokens + user profile from SecureStore
  useEffect(() => {
    dispatch(hydrateAuth());
  }, []);

  // Once authenticated, immediately check whether the wallet already exists
  // on the backend. If fetchAddresses returns data, walletSlice will set
  // walletReady = true and AppNavigator will route to Dashboard (not WalletSetup).
  useEffect(() => {
    if (isAuthenticated) {
      dispatch(fetchAddresses());
    }
  }, [isAuthenticated]);

  return (
    <>
      <StatusBar style="light" backgroundColor="transparent" translucent />
      <AppNavigator />
    </>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <AppInner />
      </SafeAreaProvider>
    </Provider>
  );
}