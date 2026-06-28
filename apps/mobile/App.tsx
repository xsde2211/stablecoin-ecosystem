import 'react-native-get-random-values';
import { Buffer } from 'buffer';
global.Buffer = Buffer;

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import { store } from './src/store';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor="transparent" translucent />
        <AppNavigator />
      </SafeAreaProvider>
    </Provider>
  );
}
