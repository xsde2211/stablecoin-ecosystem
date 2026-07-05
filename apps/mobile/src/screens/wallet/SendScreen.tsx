import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { Header }    from '../../components/ui/Header';
import { Button }    from '../../components/ui/Button';
import { Card }      from '../../components/ui/Card';
import { TokenIcon }  from '../../components/ui/TokenIcon';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import type { RootState } from '../../store';

const TOKENS = ['INRX', 'EGOLD', 'ESLVR'];
const CHAINS  = ['tron', 'ethereum', 'bsc', 'polygon'];
// Tab bar heights: use this so footer always sits above the tab bar
const TAB_H = Platform.OS === 'ios' ? 84 : 68;

export default function SendScreen() {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const insets     = useSafeAreaInsets();
  // Screens inside a tab need to clear the tab bar too
  const footerPb   = insets.bottom > 0 ? insets.bottom + 8 : TAB_H + 8;

  const { balances } = useSelector((s: RootState) => s.wallet);

  const [token,     setToken]     = useState(route.params?.token ?? 'INRX');
  const [chain,     setChain]     = useState('tron');
  const [toAddress, setToAddress] = useState('');
  const [amount,    setAmount]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [step,      setStep]      = useState<'form'|'review'|'success'>('form');
  const [txResult,  setTxResult]  = useState<any>(null);

  const balance          = (balances ?? []).find((b: any) => b.symbol === token && b.chain === chain);
  const availableBalance = parseFloat(balance?.balance ?? '0');

  const handleSend = async () => {
    setLoading(true);
    try {
      const res = await api.sendToken({ token, chain, toAddress, amount });
      setTxResult(res);
      setStep('success');
    } catch (err: any) {
      Alert.alert('Transaction failed', err?.response?.data?.message ?? 'Please try again');
    } finally { setLoading(false); }
  };

  // ── Success ────────────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Header title="Sent!" />
        <ScrollView contentContainerStyle={[styles.successContent, { paddingBottom: footerPb }]}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={40} color={colors.success} />
          </View>
          <Text style={typography.h2}>Sent successfully</Text>
          <Text style={styles.successDesc}>
            {amount} {token} sent to {toAddress.slice(0, 8)}...{toAddress.slice(-6)}
          </Text>
          <Card style={{ marginTop: spacing.xl, width: '100%' }}>
            <Row label="Amount"  value={`${amount} ${token}`} />
            <Row label="Network" value={chain.toUpperCase()} />
            <Row label="Status"  value="Pending confirmation" valueColor={colors.warning} />
            {txResult?.txHash && <Row label="Tx Hash" value={`${txResult.txHash.slice(0,10)}…`} mono last />}
          </Card>
          <View style={{ height: spacing.xl }} />
          <Button label="Done" onPress={() => navigation.navigate('Dashboard')} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Review ─────────────────────────────────────────────────────────────────
  if (step === 'review') {
    return (
      <SafeAreaView style={styles.flex} edges={[]}>
        <Header title="Review" />
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
              <TokenIcon token={token} size={56} />
              <Text style={[typography.h1, { marginTop: spacing.md, color: colors.textSecondary }]}>{amount} {token}</Text>
              <Text style={styles.reviewSub}>on {chain.toUpperCase()}</Text>
            </Card>
            <Card style={{ marginTop: spacing.lg }}>
              <Row label="To"                value={`${toAddress.slice(0,10)}…${toAddress.slice(-6)}`} mono />
              <Row label="Network"           value={chain.toUpperCase()} />
              <Row label="Available balance" value={`${availableBalance.toFixed(4)} ${token}`} />
              <Row label="Network fee"       value="~0.001" last />
            </Card>
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: footerPb }]}>
            <Button label="Confirm & Send" onPress={handleSend} loading={loading} />
            <View style={{ height: spacing.sm }} />
            <Button label="Edit" variant="ghost" onPress={() => setStep('form')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.flex} edges={[]}>
        <Header title="Send" subtitle="Transfer tokens to any address" />
        <View style={styles.flex}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Token selector */}
            <Text style={styles.label}>Asset</Text>
            <View style={styles.tokenRow}>
              {TOKENS.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.tokenChip, token === t && styles.tokenChipActive]}
                  onPress={() => setToken(t)}
                  activeOpacity={0.7}
                >
                  <TokenIcon token={t} size={26} />
                  <Text style={[styles.tokenChipText, token === t && { color: colors.text }]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Chain selector */}
            <Text style={styles.label}>Network</Text>
            <View style={styles.chainRow}>
              {CHAINS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[styles.chainChip, chain === c && styles.chainChipActive]}
                  onPress={() => setChain(c)}
                  activeOpacity={0.7}
                >
                  <ChainBadge chain={c} />
                </TouchableOpacity>
              ))}
            </View>

            {/* Amount — single clean input, not a broken flex row */}
            <View style={styles.amountHeader}>
              <Text style={styles.label}>Amount</Text>
              <Text style={styles.balanceText}>Balance: {availableBalance.toFixed(4)} {token}</Text>
            </View>
            <View style={styles.amountBox}>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.textTertiary}
              />
              <TouchableOpacity
                style={styles.maxBtn}
                onPress={() => setAmount(availableBalance.toString())}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
              >
                <Text style={styles.maxBtnText}>MAX</Text>
              </TouchableOpacity>
              <Text style={styles.amountSuffix}>{token}</Text>
            </View>

            {/* Recipient */}
            <Text style={styles.label}>Recipient Address</Text>
            <View style={styles.addrBox}>
              <TextInput
                style={styles.addrInput}
                value={toAddress}
                onChangeText={setToAddress}
                placeholder={`Enter ${chain} address`}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Ionicons name="scan-outline" size={20} color={colors.teal} style={{ padding: spacing.sm }} />
            </View>

            <View style={{ height: spacing.xl }} />
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: footerPb }]}>
            <Button
              label="Continue"
              onPress={() => setStep('review')}
              disabled={!toAddress || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > availableBalance}
            />
          </View>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, valueColor, mono, last }: any) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && typography.mono, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  footer:  { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  successContent: { paddingHorizontal: spacing.xl, alignItems: 'center', paddingTop: spacing.xxxl },
  successIcon:    { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.success + '40' },
  successDesc:    { ...typography.body, color: colors.textSecondary, marginTop: 8, textAlign: 'center' },
  reviewSub:      { ...typography.sm, color: colors.textSecondary, marginTop: 4 },

  label: { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const, marginBottom: spacing.sm, marginTop: spacing.lg },

  tokenRow: { flexDirection: 'row', gap: spacing.sm },
  tokenChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
  },
  tokenChipActive: { borderColor: colors.teal, backgroundColor: colors.tealBg },
  tokenChipText:   { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },

  chainRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chainChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
  },
  chainChipActive: { borderColor: colors.teal, backgroundColor: colors.tealBg },

  amountHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
  balanceText:  { ...typography.xs, color: colors.textTertiary },

  // Single clean amount box — no weird thin oval
  amountBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 60,
  },
  amountInput: { flex: 1, ...typography.h3, color: colors.text, fontWeight: '700' as const, paddingVertical: 0 },
  amountSuffix:{ ...typography.sm, color: colors.textTertiary, marginLeft: 4 },
  maxBtn:      { backgroundColor: colors.tealBg2, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md, marginLeft: spacing.sm },
  maxBtnText:  { ...typography.xs, color: colors.teal, fontWeight: '700' as const },

  addrBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    paddingLeft: spacing.md, height: 56,
  },
  addrInput: { flex: 1, ...typography.body, color: colors.text, paddingVertical: 0 },

  row:       { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel:  { ...typography.sm, color: colors.textSecondary },
  rowValue:  { ...typography.sm, color: colors.text, fontWeight: '600' as const },
});