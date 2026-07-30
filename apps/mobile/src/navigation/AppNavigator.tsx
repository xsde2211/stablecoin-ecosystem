import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, AppState, AppStateStatus } from 'react-native';
import { useSelector, useDispatch }    from 'react-redux';
import AsyncStorage                    from '@react-native-async-storage/async-storage';
import { NavigationContainer }        from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator }   from '@react-navigation/bottom-tabs';
import { Ionicons }                   from '@expo/vector-icons';

import WelcomeScreen        from '../screens/auth/WelcomeScreen';
import LoginScreen          from '../screens/auth/LoginScreen';
import RegisterScreen       from '../screens/auth/RegisterScreen';
import WalletSetupScreen    from '../screens/auth/WalletSetupScreen';
import BiometricLockScreen  from '../screens/auth/BiometricLockScreen';
import DashboardScreen         from '../screens/wallet/DashboardScreen';
import SendScreen              from '../screens/wallet/SendScreen';
import ReceiveScreen           from '../screens/wallet/ReceiveScreen';
import TokenDetailScreen       from '../screens/wallet/TokenDetailScreen';
import TransactionsScreen      from '../screens/wallet/TransactionsScreen';
import TransactionDetailScreen from '../screens/wallet/TransactionDetailScreen';
import BridgeScreen        from '../screens/bridge/BridgeScreen';
import BridgeHistoryScreen from '../screens/bridge/BridgeHistoryScreen';
import SwapScreen          from '../screens/swap/SwapScreen';
import SwapHistoryScreen from '../screens/swap/SwapHistoryScreen';
import PayQRScreen         from '../screens/payments/PayQRScreen';
import CreatePaymentScreen from '../screens/payments/CreatePaymentScreen';
import PaymentDetailScreen from '../screens/payments/PaymentDetailScreen';
import KycScreen              from '../screens/kyc/KycScreen';
import ProfileScreen          from '../screens/profile/ProfileScreen';
import TwoFactorSetupScreen   from '../screens/profile/TwoFactorSetupScreen';
import MerchantRegisterScreen from '../screens/profile/MerchantRegisterScreen';
import SettingsScreen         from '../screens/settings/SettingsScreen';
import WalletManagerScreen    from '../screens/wallet/WalletManagerScreen';
import NotificationsScreen    from '../screens/notifications/NotificationsScreen';
import TreasuryRequestScreen from '../screens/treasury/TreasuryRequestScreen';

import { colors } from '../theme';
import { relockApp } from '../store/slices/authSlice';
import type { AppDispatch, RootState } from '../store';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();
const screenOpts = { headerShown: false, animation: 'slide_from_right' as const, gestureEnabled: true };

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts} initialRouteName="Welcome">
      <Stack.Screen name="Welcome"     component={WelcomeScreen} />
      <Stack.Screen name="Login"       component={LoginScreen} />
      <Stack.Screen name="Register"    component={RegisterScreen} />
      <Stack.Screen name="WalletSetup" component={WalletSetupScreen} />
    </Stack.Navigator>
  );
}

function DashboardStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="Dashboard"        component={DashboardScreen} />
      <Stack.Screen name="Send"             component={SendScreen} />
      <Stack.Screen name="Receive"          component={ReceiveScreen} />
      <Stack.Screen name="TokenDetail"      component={TokenDetailScreen} />
      <Stack.Screen name="Swap"             component={SwapScreen} />
      <Stack.Screen name="SwapHistory" component={SwapHistoryScreen} />
      <Stack.Screen name="PayQR"            component={PayQRScreen} />
      <Stack.Screen name="CreatePayment"    component={CreatePaymentScreen} />
      <Stack.Screen name="PaymentDetail"    component={PaymentDetailScreen} />
      <Stack.Screen name="Kyc"              component={KycScreen} />
      <Stack.Screen name="Notifications"    component={NotificationsScreen} />
      <Stack.Screen name="MerchantRegister" component={MerchantRegisterScreen} />
      <Stack.Screen name="WalletManager"    component={WalletManagerScreen} />
      <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
    </Stack.Navigator>
  );
}

function TransactionStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="Transactions"      component={TransactionsScreen} />
      <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
    </Stack.Navigator>
  );
}

function BridgeStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="Bridge"        component={BridgeScreen} />
      <Stack.Screen name="BridgeHistory" component={BridgeHistoryScreen} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={screenOpts}>
      <Stack.Screen name="Profile"          component={ProfileScreen} />
      <Stack.Screen name="Settings"         component={SettingsScreen} />
      <Stack.Screen name="TwoFactorSetup"   component={TwoFactorSetupScreen} />
      <Stack.Screen name="MerchantRegister" component={MerchantRegisterScreen} />
      <Stack.Screen name="Kyc"              component={KycScreen} />
      <Stack.Screen name="Notifications"    component={NotificationsScreen} />
      <Stack.Screen name="WalletManager"    component={WalletManagerScreen} />
      <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
      <Stack.Screen name="TreasuryRequest" component={TreasuryRequestScreen} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown:             false,
        tabBarStyle:             styles.tabBar,
        tabBarBackground:        () => <View style={styles.tabBarBg} />,
        tabBarActiveTintColor:   colors.teal,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle:        styles.tabLabel,
        tabBarHideOnKeyboard:    true,
        tabBarIcon: ({ focused, color }) => {
          const icons: Record<string, [string, string]> = {
            DashboardTab:   ['wallet',          'wallet-outline'],
            TransactionTab: ['receipt',         'receipt-outline'],
            BridgeTab:      ['swap-horizontal', 'swap-horizontal-outline'],
            ProfileTab:     ['person-circle',   'person-circle-outline'],
          };
          const [active, inactive] = icons[route.name] ?? ['ellipse', 'ellipse-outline'];
          return (
            <Ionicons
              name={(focused ? active : inactive) as any}
              size={focused ? 24 : 22}
              color={color}
            />
          );
        },
      })}
    >
      <Tab.Screen name="DashboardTab"   component={DashboardStack}  options={{ title: 'Home' }} />
      <Tab.Screen name="TransactionTab" component={TransactionStack} options={{ title: 'Activity' }} />
      <Tab.Screen name="BridgeTab"      component={BridgeStack}      options={{ title: 'Bridge' }} />
      <Tab.Screen name="ProfileTab"     component={ProfileStack}     options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

const K_BIO = '@pref_biometric';

export default function AppNavigator() {
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, locked } = useSelector((s: RootState) => s.auth);
  const { walletReady }             = useSelector((s: RootState) => s.wallet);

  // Re-arm the biometric gate whenever the app comes back from the
  // background/inactive state — this is the actual point of biometric
  // login: it doesn't replace password + 2FA (those authenticate a brand
  // new session with the server), it re-confirms it's still you holding
  // *this* device before an already-unlocked session is shown again, e.g.
  // after someone else picks up your phone or you reopen the app later.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      const wasBackground = appState.current.match(/inactive|background/);
      if (wasBackground && next === 'active' && isAuthenticated && walletReady) {
        const bioPref = await AsyncStorage.getItem(K_BIO);
        if (bioPref === 'true') dispatch(relockApp());
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [dispatch, isAuthenticated, walletReady]);

  let initialRoute = 'Auth';
  if (isAuthenticated && !walletReady) initialRoute = 'WalletSetupModal';
  if (isAuthenticated && walletReady)  initialRoute = locked ? 'BiometricLock' : 'Main';

  return (
    <NavigationContainer>
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    {!isAuthenticated ? (
      <Stack.Screen
        name="Auth"
        component={AuthStack}
      />
    ) : !walletReady ? (
      <Stack.Screen
        name="WalletSetupModal"
        component={WalletSetupScreen}
      />
    ) : locked ? (
      <Stack.Screen
        name="BiometricLock"
        component={BiometricLockScreen}
      />
    ) : (
      <Stack.Screen
        name="Main"
        component={MainTabs}
      />
    )}
  </Stack.Navigator>
</NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute', borderTopWidth: 1, borderTopColor: colors.border,
    height: Platform.OS === 'ios' ? 84 : 68,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
    paddingTop: 8, elevation: 0, backgroundColor: 'transparent',
  },
  tabBarBg:  { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bgSecondary + 'F5' },
  tabLabel:  { fontSize: 10, fontWeight: '600' as const },
});
