import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useDispatch, useSelector } from 'react-redux';
import { Text } from 'react-native';
import { hydrateAuth } from '../store/slices/authSlice';
import { AppDispatch, RootState } from '../store';

import { LoginScreen }        from '../screens/auth/LoginScreen';
import { RegisterScreen }     from '../screens/auth/RegisterScreen';
import { DashboardScreen }    from '../screens/wallet/DashboardScreen';
import { SendScreen }         from '../screens/wallet/SendScreen';
import { ReceiveScreen }      from '../screens/wallet/ReceiveScreen';
import { CreateWalletScreen } from '../screens/wallet/CreateWalletScreen';
import { BridgeScreen }       from '../screens/bridge/BridgeScreen';
import { ScanScreen }         from '../screens/payments/ScanScreen';
import { ProfileScreen }      from '../screens/profile/ProfileScreen';
import { KYCScreen }          from '../screens/kyc/KYCScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

function TabIcon({ name, focused }: { name:string; focused:boolean }) {
  const icons: Record<string,string> = {
    Home:'⬡', Bridge:'⇄', Scan:'⊙', Profile:'◎',
  };
  return (
    <Text style={{ fontSize:22, color: focused ? colors.teal : colors.textTertiary }}>
      {icons[name] ?? '●'}
    </Text>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor:  colors.border,
          borderTopWidth:  1,
          height:          80,
          paddingBottom:   20,
          paddingTop:      10,
        },
        tabBarActiveTintColor:   colors.teal,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { fontSize:11, fontWeight:'600' },
        tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
      })}
    >
      <Tab.Screen name="Home"    component={DashboardScreen} />
      <Tab.Screen name="Bridge"  component={BridgeScreen}    />
      <Tab.Screen name="Scan"    component={ScanScreen}      />
      <Tab.Screen name="Profile" component={ProfileScreen}   />
    </Tab.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown:false }}>
      <Stack.Screen name="Login"    component={LoginScreen}    />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
}

function AppStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown:false }}>
      <Stack.Screen name="MainTabs"     component={MainTabs}           />
      <Stack.Screen name="Send"         component={SendScreen}         />
      <Stack.Screen name="Receive"      component={ReceiveScreen}      />
      <Stack.Screen name="CreateWallet" component={CreateWalletScreen} />
      <Stack.Screen name="KYC"          component={KYCScreen}          />
    </Stack.Navigator>
  );
}

export function AppNavigator() {
  const dispatch   = useDispatch<AppDispatch>();
  const { user, hydrated } = useSelector((s: RootState) => s.auth);

  useEffect(() => { dispatch(hydrateAuth()); }, []);

  if (!hydrated) {
    return (
      <View style={{ flex:1, backgroundColor:colors.bg, alignItems:'center', justifyContent:'center' }}>
        <View style={{ width:56, height:56, borderRadius:28, backgroundColor:colors.tealBg,
                       alignItems:'center', justifyContent:'center', borderWidth:1.5, borderColor:colors.teal }}>
          <Text style={{ fontSize:22, color:colors.teal }}>e₹</Text>
        </View>
        <ActivityIndicator color={colors.teal} style={{ marginTop:24 }} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {user ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
