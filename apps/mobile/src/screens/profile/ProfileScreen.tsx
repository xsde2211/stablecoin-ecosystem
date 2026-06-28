import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, Alert,
} from 'react-native';
import { Ionicons }      from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { Header }   from '../../components/ui/Header';
import { Card }     from '../../components/ui/Card';
import { Badge }    from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, typography, spacing, radius } from '../../theme';
import { api }      from '../../services/api';
import { logout }   from '../../store/slices/authSlice';
import type { AppDispatch, RootState } from '../../store';

const KYC_CFG: Record<string, { label: string; variant: any; icon: any; color: string }> = {
  NOT_SUBMITTED: { label: 'Unverified',   variant: 'default',  icon: 'alert-circle-outline',   color: colors.textSecondary },
  SUBMITTED:     { label: 'Under Review', variant: 'warning',  icon: 'time-outline',            color: colors.warning },
  APPROVED:      { label: 'Verified ✓',   variant: 'success',  icon: 'shield-checkmark',        color: colors.success },
  REJECTED:      { label: 'Rejected',     variant: 'error',    icon: 'close-circle-outline',    color: colors.error },
};

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const dispatch   = useDispatch<AppDispatch>();
  const { user }   = useSelector((s: RootState) => s.auth);

  const [kycStatus, setKycStatus] = useState('NOT_SUBMITTED');
  const [twoFaOn,   setTwoFaOn]   = useState(false);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.getKycStatus().then(r => setKycStatus(r.kycStatus ?? 'NOT_SUBMITTED')),
      api.getMe().then((r: any) => setTwoFaOn(!!r.twoFaEnabled)),
    ]).finally(() => setLoading(false));
  }, []);

  // Display name: never shows raw email like "sourabhgupta1221"
  const displayName = (() => {
    if (!user) return 'Welcome';
    const u = user as any;
    if (u.fullName) return u.fullName;
    if (u.name)     return u.name;
    const local = (u.email ?? '').split('@')[0] ?? '';
    // Strip numbers, capitalise: sourabhgupta1221 → Sourabh Gupta
    const clean = local.replace(/[0-9]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  })();

  const email   = (user as any)?.email ?? '';
  const initial = displayName.charAt(0).toUpperCase();
  const kycCfg  = KYC_CFG[kycStatus] ?? KYC_CFG.NOT_SUBMITTED;

  const handleLogout = () =>
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => dispatch(logout()) },
    ]);

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Profile" showBack={false} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Avatar section */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.displayName}>{displayName}</Text>
          <Text style={styles.email}>{email}</Text>
          <View style={styles.kycBadgeRow}>
            <Ionicons name={kycCfg.icon} size={14} color={kycCfg.color} />
            <Badge label={kycCfg.label} variant={kycCfg.variant} />
          </View>
        </View>

        {/* Stats strip */}
        {!loading ? (
          <View style={styles.statsStrip}>
            <StatPill icon="shield-checkmark-outline" label="KYC"      value={kycStatus === 'APPROVED' ? 'Done'    : 'Pending'} active={kycStatus === 'APPROVED'} />
            <View style={styles.divider} />
            <StatPill icon="lock-closed-outline"      label="2FA"      value={twoFaOn ? 'On' : 'Off'}                          active={twoFaOn} />
            <View style={styles.divider} />
            <StatPill icon="wallet-outline"           label="Wallets"  value="5"                                               active />
          </View>
        ) : (
          <Skeleton width="100%" height={64} style={{ borderRadius: radius.xl, marginBottom: spacing.xl }} />
        )}

        {/* Account */}
        <Text style={styles.sec}>Account</Text>
        <Card padding={0}>
          <MenuRow icon="document-text-outline" label="Identity Verification" desc={kycCfg.label}                right={<Badge label={kycCfg.label} variant={kycCfg.variant} />} onPress={() => navigation.navigate('Kyc')} />
          <MenuRow icon="storefront-outline"    label="Merchant Account"      desc="Create payment QR codes"     onPress={() => navigation.navigate('MerchantRegister')} />
          <MenuRow icon="lock-closed-outline"   label="Two-Factor Auth"       desc={twoFaOn ? 'Enabled — secure' : 'Disabled — tap to enable'} right={<Badge label={twoFaOn ? 'On' : 'Off'} variant={twoFaOn ? 'success' : 'default'} />} onPress={() => navigation.navigate('TwoFactorSetup')} last />
        </Card>

        {/* Settings */}
        <Text style={styles.sec}>Settings & Security</Text>
        <Card padding={0}>
          <MenuRow icon="settings-outline"      label="App Settings"   desc="Password, biometrics, notifications" onPress={() => navigation.navigate('Settings')} />
          <MenuRow icon="notifications-outline" label="Notifications"  desc="View your alerts"                    onPress={() => navigation.navigate('Notifications')} last />
        </Card>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatPill({ icon, label, value, active }: any) {
  return (
    <View style={spS.pill}>
      <Ionicons name={icon} size={16} color={active ? colors.teal : colors.textTertiary} />
      <Text style={spS.label}>{label}</Text>
      <Text style={[spS.value, active && { color: colors.teal }]}>{value}</Text>
    </View>
  );
}
const spS = StyleSheet.create({
  pill:  { flex: 1, alignItems: 'center', gap: 3 },
  label: { ...typography.xs, color: colors.textTertiary },
  value: { ...typography.sm, color: colors.textSecondary, fontWeight: '700' as const },
});

function MenuRow({ icon, label, desc, onPress, right, last }: any) {
  return (
    <TouchableOpacity
      style={[mS.row, !last && mS.border]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={mS.icon}>
        <Ionicons name={icon} size={18} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={mS.label}>{label}</Text>
        {desc ? <Text style={mS.desc}>{desc}</Text> : null}
      </View>
      {right ?? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />}
    </TouchableOpacity>
  );
}
const mS = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.md, minHeight: 60, gap: spacing.md },
  border: { borderBottomWidth: 1, borderBottomColor: colors.border },
  icon:   { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  label:  { ...typography.sm, color: colors.text, fontWeight: '600' as const },
  desc:   { ...typography.xs, color: colors.textTertiary, marginTop: 2 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content:   { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  avatarSection: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.tealBg2, borderWidth: 2, borderColor: colors.teal, alignItems: 'center', justifyContent: 'center' },
  avatarText:   { fontSize: 32, fontWeight: '700' as const, color: colors.teal },
  displayName:  { ...typography.h2, color: colors.text },
  email:        { ...typography.sm, color: colors.textSecondary },
  kycBadgeRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statsStrip: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.xl },
  divider:    { width: 1, backgroundColor: colors.border },
  sec: { ...typography.xs, color: colors.textTertiary, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: spacing.sm, marginTop: spacing.lg },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl, padding: spacing.md, backgroundColor: colors.errorBg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.error + '30' },
  logoutText:{ ...typography.sm, color: colors.error, fontWeight: '700' as const },
});
