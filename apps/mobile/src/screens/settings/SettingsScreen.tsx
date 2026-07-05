import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, Alert, Switch, Linking, TextInput, Platform,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications       from 'expo-notifications';
import AsyncStorage             from '@react-native-async-storage/async-storage';
import { Ionicons }             from '@expo/vector-icons';
import { useDispatch }          from 'react-redux';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Header }               from '../../components/ui/Header';
import { Card }                 from '../../components/ui/Card';
import { Button }               from '../../components/ui/Button';
import { colors, typography, spacing, radius } from '../../theme';
import { api }                  from '../../services/api';
import { logout }               from '../../store/slices/authSlice';
import type { AppDispatch }     from '../../store';

const K_BIO   = '@pref_biometric';
const K_PUSH  = '@pref_push';
const K_EMAIL = '@pref_email';

// Same status set as KycScreen — kept condensed for a single settings row.
// NOTE: 'Kyc' below must match whatever route name your navigator registers
// KycScreen under — change it if your app uses a different route name.
const KYC_ROUTE = 'Kyc';

const KYC_CFG: Record<string, { icon: any; color: string; label: string; action: string }> = {
  NOT_SUBMITTED: { icon: 'shield-outline',        color: colors.textSecondary, label: 'Not submitted', action: 'Start Verification' },
  SUBMITTED:     { icon: 'time-outline',          color: colors.warning,       label: 'Under review',  action: 'Refresh Status' },
  APPROVED:      { icon: 'shield-checkmark',       color: colors.success,       label: 'Verified',      action: 'View' },
  REJECTED:      { icon: 'close-circle',           color: colors.error,         label: 'Rejected',      action: 'Resubmit KYC' },
};

export default function SettingsScreen() {
  const dispatch   = useDispatch<AppDispatch>();
  const navigation = useNavigation<any>();

  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled,   setBioEnabled]   = useState(false);
  const [pushEnabled,  setPushEnabled]  = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);

  // ── KYC status ──────────────────────────────────────────────────────────
  const [kycStatus,  setKycStatus]  = useState('NOT_SUBMITTED');
  const [kycLoading, setKycLoading] = useState(true);

  const loadKyc = useCallback(async () => {
    try {
      const res = await api.getKycStatus();
      setKycStatus(res?.kycStatus ?? 'NOT_SUBMITTED');
    } catch {
      // leave last-known status on failure rather than resetting
    } finally {
      setKycLoading(false);
    }
  }, []);

  // Refresh every time this screen regains focus — e.g. returning from the
  // KYC form, or coming back after admin approval — so the status shown here
  // always reflects the latest backend state without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      loadKyc();
    }, [loadKyc])
  );

  const kcfg = KYC_CFG[kycStatus] ?? KYC_CFG.NOT_SUBMITTED;

  const [showPwd,    setShowPwd]    = useState(false);
  const [curPwd,     setCurPwd]     = useState('');
  const [newPwd,     setNewPwd]     = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showCur,    setShowCur]    = useState(false);
  const [showNew,    setShowNew]    = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const hw  = await LocalAuthentication.hasHardwareAsync();
      const enr = await LocalAuthentication.isEnrolledAsync();
      setBioSupported(hw && enr);
      const [b, p, e] = await Promise.all([
        AsyncStorage.getItem(K_BIO),
        AsyncStorage.getItem(K_PUSH),
        AsyncStorage.getItem(K_EMAIL),
      ]);
      setBioEnabled(b === 'true');
      const { status } = await Notifications.getPermissionsAsync();
      setPushEnabled(p === 'true' && status === 'granted');
      setEmailEnabled(e === 'true');
    })();
  }, []);

  const toggleBiometric = async (v: boolean) => {
    if (v) {
      if (!bioSupported) { Alert.alert('Not available', 'Biometric hardware not found or no fingerprint/face enrolled.'); return; }
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Verify to enable biometric login', fallbackLabel: 'Use passcode' });
      if (!r.success) { Alert.alert('Failed', 'Biometric verification failed.'); return; }
    }
    setBioEnabled(v);
    await AsyncStorage.setItem(K_BIO, String(v));
  };

  const togglePush = async (v: boolean) => {
    if (v) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Enable notifications in Settings → Apps → Stablecoin Wallet.', [
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
          { text: 'Cancel', style: 'cancel' },
        ]);
        return;
      }
      try {
        const t = await Notifications.getExpoPushTokenAsync();
        if (t?.data) api.registerFcm(t.data).catch(() => {});
      } catch {}
    }
    setPushEnabled(v);
    await AsyncStorage.setItem(K_PUSH, String(v));
  };

  const toggleEmail = async (v: boolean) => {
    setEmailEnabled(v);
    await AsyncStorage.setItem(K_EMAIL, String(v));
    if (v) Alert.alert('Email alerts on', 'You\'ll receive login and transaction alerts at your registered email.');
  };

  const openURL = async (url: string) => {
    const ok = await Linking.canOpenURL(url).catch(() => false);
    if (ok) Linking.openURL(url);
    else Alert.alert('Coming soon', 'Our Terms and Privacy Policy will be available at launch. Please check back later.');
  };

  const handleChangePwd = async () => {
    if (!curPwd || !newPwd || !confirmPwd) { Alert.alert('Fill all fields'); return; }
    if (newPwd !== confirmPwd)             { Alert.alert('New passwords don\'t match'); return; }
    if (newPwd.length < 8)                { Alert.alert('Password too short', 'Minimum 8 characters.'); return; }
    if (!/[A-Z]/.test(newPwd))            { Alert.alert('Weak password', 'Include at least one uppercase letter.'); return; }
    if (!/\d/.test(newPwd))               { Alert.alert('Weak password', 'Include at least one number.'); return; }
    setPwdLoading(true);
    try {
      await api.changePassword({ currentPassword: curPwd, newPassword: newPwd });
      setCurPwd(''); setNewPwd(''); setConfirmPwd(''); setShowPwd(false);
      Alert.alert('Password updated ✓', 'Your password has been changed successfully.');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to change password.');
    } finally { setPwdLoading(false); }
  };

  const handleLogout = () =>
    Alert.alert('Log out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => dispatch(logout()) },
    ]);

  const pwdStrength = [newPwd.length >= 8, /[A-Z]/.test(newPwd), /[a-z]/.test(newPwd), /\d/.test(newPwd)];
  const strengthLevel = pwdStrength.filter(Boolean).length;

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Settings" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Identity Verification (KYC) ──────────────────────────────── */}
        <Text style={styles.sec}>Identity Verification</Text>
        <Card padding={0}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate(KYC_ROUTE)}
            activeOpacity={0.7}
            disabled={kycLoading}
          >
            <View style={[styles.rowIcon, { backgroundColor: kcfg.color + '20' }]}>
              <Ionicons name={kcfg.icon} size={18} color={kcfg.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>KYC Status</Text>
              <Text style={[styles.rowSub, { color: kcfg.color }]}>
                {kycLoading ? 'Checking…' : kcfg.label}
              </Text>
            </View>
            {!kycLoading && (
              <View style={styles.manageBtn}>
                <Text style={styles.manageBtnText}>{kcfg.action}</Text>
              </View>
            )}
          </TouchableOpacity>
        </Card>

        {/* ── Security ──────────────────────────────────────────────── */}
        <Text style={styles.sec}>Security</Text>
        <Card padding={0}>
          {/* Change Password */}
          <TouchableOpacity style={[styles.row, !showPwd && styles.rowBorder]} onPress={() => setShowPwd(!showPwd)} activeOpacity={0.7}>
            <View style={styles.rowIcon}><Ionicons name="key-outline" size={18} color={colors.textSecondary} /></View>
            <Text style={styles.rowLabel}>Change Password</Text>
            <Ionicons name={showPwd ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
          </TouchableOpacity>
          {showPwd && (
            <View style={styles.pwdForm}>
              <PwdField label="Current password" value={curPwd} onChange={setCurPwd} show={showCur} onToggle={() => setShowCur(!showCur)} />
              <PwdField label="New password"     value={newPwd} onChange={setNewPwd} show={showNew} onToggle={() => setShowNew(!showNew)} />
              <PwdField label="Confirm password" value={confirmPwd} onChange={setConfirmPwd} show={showNew} onToggle={() => setShowNew(!showNew)} />
              {newPwd.length > 0 && (
                <View style={styles.strengthRow}>
                  {pwdStrength.map((ok, i) => (
                    <View key={i} style={[styles.strengthBar, { backgroundColor: ok ? (strengthLevel >= 4 ? colors.success : colors.warning) : colors.border }]} />
                  ))}
                </View>
              )}
              <View style={styles.pwdBtns}>
                <View style={{ flex: 1 }}><Button label="Update" onPress={handleChangePwd} loading={pwdLoading} size="sm" /></View>
                <View style={{ flex: 1 }}>
                  <Button label="Cancel" variant="secondary" size="sm" onPress={() => { setShowPwd(false); setCurPwd(''); setNewPwd(''); setConfirmPwd(''); }} />
                </View>
              </View>
            </View>
          )}

          {/* Biometric */}
          <View style={[styles.row, styles.rowBorder]}>
            <View style={styles.rowIcon}><Ionicons name="finger-print-outline" size={18} color={colors.textSecondary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Biometric Login</Text>
              <Text style={styles.rowSub}>{bioSupported ? 'Use fingerprint or Face ID' : 'Not available on this device'}</Text>
            </View>
            <Switch value={bioEnabled} onValueChange={toggleBiometric} disabled={!bioSupported} trackColor={{ false: colors.border, true: colors.teal }} thumbColor="#fff" />
          </View>

          {/* 2FA */}
          <View style={styles.row}>
            <View style={styles.rowIcon}><Ionicons name="shield-checkmark-outline" size={18} color={colors.textSecondary} /></View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Two-Factor Auth</Text>
            <TouchableOpacity style={styles.manageBtn} onPress={() => navigation.navigate('TwoFactorSetup')} activeOpacity={0.7}>
              <Text style={styles.manageBtnText}>Manage</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* ── Notifications ─────────────────────────────────────────── */}
        <Text style={styles.sec}>Notifications</Text>
        <Card padding={0}>
          <View style={[styles.row, styles.rowBorder]}>
            <View style={styles.rowIcon}><Ionicons name="notifications-outline" size={18} color={colors.textSecondary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Push Notifications</Text>
              <Text style={styles.rowSub}>{pushEnabled ? 'Enabled — you\'ll get real-time alerts' : 'Tap to enable transaction alerts'}</Text>
            </View>
            <Switch value={pushEnabled} onValueChange={togglePush} trackColor={{ false: colors.border, true: colors.teal }} thumbColor="#fff" />
          </View>
          <View style={styles.row}>
            <View style={styles.rowIcon}><Ionicons name="mail-outline" size={18} color={colors.textSecondary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Email Alerts</Text>
              <Text style={styles.rowSub}>Login, large transactions, KYC updates</Text>
            </View>
            <Switch value={emailEnabled} onValueChange={toggleEmail} trackColor={{ false: colors.border, true: colors.teal }} thumbColor="#fff" />
          </View>
        </Card>

        {/* ── About ──────────────────────────────────────────────────── */}
        <Text style={styles.sec}>About</Text>
        <Card padding={0}>
          <Link icon="document-text-outline" label="Terms of Service" onPress={() => openURL('https://stablecoin-ecosystem.example.com/terms')} />
          <Link icon="shield-outline"        label="Privacy Policy"   onPress={() => openURL('https://stablecoin-ecosystem.example.com/privacy')} />
          <Link icon="code-slash-outline"    label="App Version"      right="1.0.0" />
          <Link icon="server-outline"        label="Network"          right="Testnet" last />
        </Card>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function PwdField({ label, value, onChange, show, onToggle }: any) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={{ ...typography.xs, color: colors.textTertiary, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md }}>
        <TextInput style={{ flex: 1, ...typography.sm, color: colors.text, paddingVertical: spacing.sm }} value={value} onChangeText={onChange} secureTextEntry={!show} placeholder="••••••••" placeholderTextColor={colors.textTertiary} />
        <TouchableOpacity onPress={onToggle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Link({ icon, label, onPress, right, last }: any) {
  return (
    <TouchableOpacity style={[styles.row, !last && styles.rowBorder]} onPress={onPress} disabled={!onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.textSecondary} /></View>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      {right ? <Text style={styles.rowRight}>{right}</Text> : onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content:   { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  sec: { ...typography.xs, color: colors.textTertiary, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.8, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.md, minHeight: 56 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon:   { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  rowLabel:  { ...typography.sm, color: colors.text, fontWeight: '600' as const },
  rowSub:    { ...typography.xs, color: colors.textTertiary, marginTop: 2 },
  rowRight:  { ...typography.sm, color: colors.textTertiary },
  manageBtn: { backgroundColor: colors.tealBg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.tealBorder, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  manageBtnText: { ...typography.xs, color: colors.teal, fontWeight: '700' as const },
  pwdForm:   { paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  strengthRow:{ flexDirection: 'row', gap: 4, marginTop: spacing.xs, marginBottom: spacing.sm },
  strengthBar:{ flex: 1, height: 4, borderRadius: 2 },
  pwdBtns:   { flexDirection: 'row', gap: spacing.sm },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xxl, padding: spacing.md, backgroundColor: colors.errorBg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.error + '30' },
  logoutText:{ ...typography.sm, color: colors.error, fontWeight: '700' as const },
});