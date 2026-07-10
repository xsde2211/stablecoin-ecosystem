import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';
import { useDispatch } from 'react-redux';
import { unlockApp, logoutUser } from '../../store/slices/authSlice';
import { colors, typography, spacing, radius } from '../../theme';
import type { AppDispatch } from '../../store';

// Shown instead of the wallet whenever the session is restored (app cold
// start, or coming back from the background) and the person has turned on
// "Biometric Login" in Settings. Tokens are already valid at this point —
// this screen only proves it's really them holding the device before
// revealing wallet data, it does not talk to the auth server at all.
export default function BiometricLockScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const [checking, setChecking] = useState(false);
  const [error, setError]       = useState('');

  const tryUnlock = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      const hw  = await LocalAuthentication.hasHardwareAsync();
      const enr = await LocalAuthentication.isEnrolledAsync();
      if (!hw || !enr) {
        // Hardware got disabled/unenrolled since the preference was turned
        // on — don't strand the person behind a lock screen they can never
        // pass. Let them through; Settings will reflect this next visit.
        dispatch(unlockApp());
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock your wallet',
        fallbackLabel: 'Use passcode',
        disableDeviceFallback: false,
      });
      if (result.success) {
        dispatch(unlockApp());
      } else {
        setError('Verification failed or cancelled. Try again.');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setChecking(false);
    }
  }, [dispatch]);

  useEffect(() => { tryUnlock(); }, [tryUnlock]);

  const handleLogout = () =>
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => dispatch(logoutUser()) },
    ]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Ionicons name="finger-print" size={52} color={colors.teal} />
        </View>
        <Text style={styles.title}>Wallet Locked</Text>
        <Text style={styles.subtitle}>
          Verify it's you with Face ID or your fingerprint to continue.
        </Text>

        {!!error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={tryUnlock}
          activeOpacity={0.85}
          disabled={checking}
        >
          {checking ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.buttonText}>Try Again</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.logoutText}>Log out instead</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  iconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.tealBg2, borderWidth: 1.5, borderColor: colors.tealBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl,
  },
  title:    { ...typography.h2, color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg,
    padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.lg, width: '100%',
  },
  errorText: { ...typography.sm, color: colors.error, flex: 1 },
  button: {
    width: '100%', backgroundColor: colors.teal, borderRadius: radius.xl,
    paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center',
    minHeight: 52,
  },
  buttonText: { ...typography.body, color: '#000', fontWeight: '700' as const },
  logoutBtn:  { marginTop: spacing.xl },
  logoutText: { ...typography.sm, color: colors.textTertiary, fontWeight: '600' as const },
});