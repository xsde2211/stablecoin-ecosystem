import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { Header }    from '../../components/ui/Header';
import { Button }    from '../../components/ui/Button';
import { TokenIcon }  from '../../components/ui/TokenIcon';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import { fetchBalances } from '../../store/slices/walletSlice';
import type { AppDispatch, RootState } from '../../store';

const TOKENS = ['INRX', 'EGOLD', 'ESLVR'];
const CHAINS  = ['tron', 'ethereum', 'bsc', 'polygon'];
const TAB_H   = Platform.OS === 'ios' ? 84 : 68;
type Mode = 'lock' | 'burn';
type Step = 'form' | 'processing' | 'success' | 'failed' | 'timeout';

// The backend now moves a transfer through these statuses in order.
// (SIGNATURES_COLLECTED only shows up once validator signatures are in —
// in MODE=PRODUCTION that can sit on LOCKED for a while until the validator
// dashboard picks it up; in MODE=TESTING it moves through automatically.)
const STATUS_ORDER = ['PENDING', 'LOCKED', 'SIGNATURES_COLLECTED', 'COMPLETED'];

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 72; // ~3 minutes

export default function BridgeScreen() {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const insets     = useSafeAreaInsets();
  const footerPb   = insets.bottom > 0 ? insets.bottom + 8 : TAB_H + 8;
  const dispatch   = useDispatch<AppDispatch>();

  const { balances, activeWalletIndex } = useSelector((s: RootState) => s.wallet);

  // Keep balances fresh for whichever wallet is currently active.
  useFocusEffect(
    useCallback(() => {
      dispatch(fetchBalances(activeWalletIndex));
    }, [dispatch, activeWalletIndex])
  );

  const [mode,       setMode]       = useState<Mode>('lock');
  const [token,      setToken]      = useState(route.params?.token ?? 'INRX');
  const [srcChain,   setSrcChain]   = useState('tron');
  const [dstChain,   setDstChain]   = useState('ethereum');
  const [amount,     setAmount]     = useState('');
  const [dstAddress, setDstAddress] = useState('');
  const [loading,    setLoading]    = useState(false);
  const [step,       setStep]       = useState<Step>('form');

  // ── Live progress tracking ────────────────────────────────────────────────
  const [transferId, setTransferId]         = useState<string | null>(null);
  const [transferStatus, setTransferStatus] = useState<string>('PENDING');
  const [errorMsg, setErrorMsg]             = useState('');
  const pollTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount  = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback((id: string) => {
    pollCount.current = 0;
    stopPolling();
    pollTimer.current = setInterval(async () => {
      pollCount.current += 1;
      try {
        const t = await api.getBridgeTransfer(id);
        setTransferStatus(t.status);
        if (t.status === 'COMPLETED') {
          stopPolling();
          dispatch(fetchBalances(activeWalletIndex)); // funds moved — refresh
          setStep('success');
        } else if (t.status === 'FAILED' || t.status === 'EXPIRED') {
          stopPolling();
          setErrorMsg(t.status === 'EXPIRED' ? 'This transfer expired before it could complete.' : 'The transfer failed while processing on-chain.');
          setStep('failed');
        }
      } catch {
        // transient network hiccup — just try again next tick
      }
      if (pollCount.current >= POLL_MAX_ATTEMPTS) {
        stopPolling();
        setStep('timeout');
      }
    }, POLL_INTERVAL_MS);
  }, [dispatch, activeWalletIndex, stopPolling]);

  const balance          = (balances ?? []).find((b: any) => b.symbol === token && b.chain === srcChain);
  const availableBalance = parseFloat(balance?.balance ?? '0');

  const swapChains = () => { const t = srcChain; setSrcChain(dstChain); setDstChain(t); };

  const handleBridge = async () => {
    setLoading(true);
    try {
      // Bridge/burn from whichever wallet is currently active.
      let res: any;
      if (mode === 'lock') {
        res = await api.initiateBridge({ srcChain, dstChain, token, amount, dstAddress, walletIndex: activeWalletIndex });
      } else {
        res = await api.burnBridge({ chain: srcChain, token, amount, srcChain: dstChain, srcRecipient: dstAddress, walletIndex: activeWalletIndex });
      }
      // IMPORTANT: this response only means the transfer was QUEUED — the
      // actual lock/burn/mint/unlock happen asynchronously afterward. Show
      // live progress instead of an immediate "success", which previously
      // claimed the bridge worked before anything had actually happened
      // on-chain yet.
      setTransferId(res.id);
      setTransferStatus(res.status ?? 'PENDING');
      setStep('processing');
      startPolling(res.id);
    } catch (err: any) {
      Alert.alert('Bridge failed', err?.response?.data?.message ?? 'Please try again');
    } finally { setLoading(false); }
  };

  const resetForm = () => {
    setStep('form');
    setAmount('');
    setDstAddress('');
    setTransferId(null);
    setTransferStatus('PENDING');
    setErrorMsg('');
  };

  // ── Processing screen ─────────────────────────────────────────────────────
  if (step === 'processing') {
    const currentIdx = STATUS_ORDER.indexOf(transferStatus);
    const stageLabel = (statusKey: string) => {
      switch (statusKey) {
        case 'PENDING':
          return `${mode === 'lock' ? 'Locking' : 'Burning'} your ${token} on ${srcChain.toUpperCase()}…`;
        case 'LOCKED':
          return `Funds ${mode === 'lock' ? 'locked' : 'burned'} on ${srcChain.toUpperCase()} ✓ — collecting validator signatures…`;
        case 'SIGNATURES_COLLECTED':
          return `Signatures collected ✓ — ${mode === 'lock' ? 'minting' : 'unlocking'} on ${dstChain.toUpperCase()}…`;
        case 'COMPLETED':
          return 'Bridge complete ✓';
        default:
          return 'Processing…';
      }
    };

    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.flex}>
          <View style={styles.successCenter}>
            <View style={styles.successIcon}>
              <ActivityIndicator color={colors.teal} size="large" />
            </View>
            <Text style={typography.h2}>Processing Bridge</Text>
            <Text style={[styles.successDesc, { marginBottom: spacing.xl }]}>
              {amount} {token} · {srcChain.toUpperCase()} → {dstChain.toUpperCase()}
            </Text>

            <View style={styles.stepList}>
              {STATUS_ORDER.map((s, i) => {
                const done    = i < currentIdx || (i === currentIdx && s === 'COMPLETED');
                const current = i === currentIdx && s !== 'COMPLETED';
                return (
                  <View key={s} style={styles.stepRow}>
                    <View style={[
                      styles.stepDot,
                      done && styles.stepDotDone,
                      current && styles.stepDotCurrent,
                    ]}>
                      {done ? (
                        <Ionicons name="checkmark" size={12} color="#000" />
                      ) : current ? (
                        <ActivityIndicator size="small" color={colors.teal} />
                      ) : null}
                    </View>
                    <Text style={[styles.stepText, (done || current) && styles.stepTextActive]}>
                      {stageLabel(s)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Timeout screen — not failed, just taking longer than expected ─────────
  if (step === 'timeout') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.flex}>
          <View style={styles.successCenter}>
            <View style={styles.successIcon}>
              <Ionicons name="time-outline" size={36} color={colors.info} />
            </View>
            <Text style={typography.h2}>Still Processing</Text>
            <Text style={styles.successDesc}>
              This is taking longer than usual. Your transfer is still moving — check Bridge History for live updates.
            </Text>
          </View>
          <View style={[styles.footer, { paddingBottom: footerPb }]}>
            <Button label="View Bridge History" variant="secondary" onPress={() => { resetForm(); navigation.navigate('BridgeHistory'); }} />
            <View style={{ height: spacing.sm }} />
            <Button label="Done" onPress={() => { resetForm(); navigation.navigate('DashboardTab'); }} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Failed screen ──────────────────────────────────────────────────────────
  if (step === 'failed') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.flex}>
          <View style={styles.successCenter}>
            <View style={[styles.successIcon, styles.failIcon]}>
              <Ionicons name="close" size={36} color={colors.error} />
            </View>
            <Text style={typography.h2}>Bridge Failed</Text>
            <Text style={styles.successDesc}>
              {errorMsg || 'Something went wrong while processing this transfer.'}{'\n\n'}
              Your original funds are safe — nothing completes on the destination chain unless the source lock/burn itself succeeded.
            </Text>
          </View>
          <View style={[styles.footer, { paddingBottom: footerPb }]}>
            <Button label="View Bridge History" variant="secondary" onPress={() => { resetForm(); navigation.navigate('BridgeHistory'); }} />
            <View style={{ height: spacing.sm }} />
            <Button label="Try Again" onPress={resetForm} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'success') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.flex}>
          <View style={styles.successCenter}>
            <View style={styles.successIcon}>
              <Ionicons name="swap-horizontal" size={36} color={colors.teal} />
            </View>
            <Text style={typography.h2}>Bridge Complete</Text>
            <Text style={styles.successDesc}>
              {amount} {token} has moved from {srcChain.toUpperCase()} → {dstChain.toUpperCase()}.
            </Text>
          </View>
          <View style={[styles.footer, { paddingBottom: footerPb }]}>
            <Button label="View Bridge History" variant="secondary" onPress={() => { resetForm(); navigation.navigate('BridgeHistory'); }} />
            <View style={{ height: spacing.sm }} />
            <Button label="Done" onPress={() => { resetForm(); navigation.navigate('DashboardTab'); }} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={[]}>
      <Header title="Bridge" subtitle="Move assets across chains" rightIcon="time-outline" onRightPress={() => navigation.navigate('BridgeHistory')} />
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Mode tabs */}
          <View style={styles.modeTabs}>
            <TouchableOpacity style={[styles.modeTab, mode === 'lock' && styles.modeTabActive]} onPress={() => setMode('lock')} activeOpacity={0.7}>
              <Text style={[styles.modeTabText, mode === 'lock' && { color: colors.teal }]}>Bridge Out</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeTab, mode === 'burn' && styles.modeTabActive]} onPress={() => setMode('burn')} activeOpacity={0.7}>
              <Text style={[styles.modeTabText, mode === 'burn' && { color: colors.teal }]}>Bridge Back</Text>
            </TouchableOpacity>
          </View>

          {/* Token */}
          <Text style={styles.label}>Asset</Text>
          <View style={styles.tokenRow}>
            {TOKENS.map(t => (
              <TouchableOpacity key={t} style={[styles.tokenChip, token === t && styles.tokenChipActive]} onPress={() => setToken(t)} activeOpacity={0.7}>
                <TokenIcon token={t} size={26} />
                <Text style={[styles.tokenChipText, token === t && { color: colors.text }]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Chain flow */}
          <View style={styles.chainFlow}>
            <View style={styles.chainBox}>
              <Text style={styles.chainLabel}>From</Text>
              <View style={styles.chainPicker}>
                {CHAINS.map(c => (
                  <TouchableOpacity key={c} onPress={() => setSrcChain(c)} style={[styles.chainOption, srcChain === c && styles.chainOptionActive]} activeOpacity={0.7}>
                    <ChainBadge chain={c} size="xs" />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity style={styles.swapBtn} onPress={swapChains} hitSlop={{ top:8,bottom:8,left:8,right:8 }} activeOpacity={0.7}>
              <Ionicons name="swap-horizontal" size={18} color={colors.teal} />
            </TouchableOpacity>
            <View style={styles.chainBox}>
              <Text style={styles.chainLabel}>To</Text>
              <View style={styles.chainPicker}>
                {CHAINS.filter(c => c !== srcChain).map(c => (
                  <TouchableOpacity key={c} onPress={() => setDstChain(c)} style={[styles.chainOption, dstChain === c && styles.chainOptionActive]} activeOpacity={0.7}>
                    <ChainBadge chain={c} size="xs" />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* Amount — clean single row */}
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
            <TouchableOpacity style={styles.maxBtn} onPress={() => setAmount(availableBalance.toString())} hitSlop={{top:8,bottom:8,left:8,right:8}} activeOpacity={0.7}>
              <Text style={styles.maxBtnText}>MAX</Text>
            </TouchableOpacity>
            <Text style={styles.amountSuffix}>{token}</Text>
          </View>

          {/* Destination address */}
          <Text style={styles.label}>Recipient address on {dstChain.toUpperCase()}</Text>
          <View style={styles.addrBox}>
            <TextInput
              style={styles.addrInput}
              value={dstAddress}
              onChangeText={setDstAddress}
              placeholder={`Your ${dstChain} wallet address`}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.infoBox}>
            <Ionicons name="time-outline" size={15} color={colors.info} />
            <Text style={styles.infoText}>Bridge transfers require validator confirmation and typically complete in 5-15 minutes.</Text>
          </View>

          <View style={{ height: spacing.xl }} />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: footerPb }]}>
          <Button
            label={mode === 'lock' ? 'Bridge Out' : 'Bridge Back'}
            onPress={handleBridge}
            loading={loading}
            disabled={!amount || !dstAddress || parseFloat(amount) <= 0 || parseFloat(amount) > availableBalance}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  footer:  { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },

  successCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  successIcon:   { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.tealBg2, borderWidth: 1, borderColor: colors.tealBorder, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  failIcon:      { backgroundColor: colors.errorBg, borderColor: colors.error + '40' },
  successDesc:   { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 22 },

  stepList: { width: '100%', gap: spacing.md },
  stepRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.surfaceHigh, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepDotDone:    { backgroundColor: colors.success, borderColor: colors.success },
  stepDotCurrent: { backgroundColor: colors.tealBg2, borderColor: colors.teal },
  stepText:      { ...typography.sm, color: colors.textTertiary, flex: 1 },
  stepTextActive:{ color: colors.text, fontWeight: '600' as const },

  modeTabs: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 4, borderWidth: 1, borderColor: colors.border },
  modeTab:  { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radius.md },
  modeTabActive: { backgroundColor: colors.tealBg2 },
  modeTabText: { ...typography.sm, color: colors.textSecondary, fontWeight: '700' as const },

  label:     { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const, marginBottom: spacing.sm, marginTop: spacing.lg },
  tokenRow:  { flexDirection: 'row', gap: spacing.sm },
  tokenChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  tokenChipActive: { borderColor: colors.teal, backgroundColor: colors.tealBg },
  tokenChipText:   { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },

  chainFlow:  { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  chainBox:   { flex: 1 },
  chainLabel: { ...typography.xs, color: colors.textTertiary, marginBottom: 6 },
  chainPicker:{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: colors.surface, padding: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, minHeight: 48 },
  chainOption:{ padding: 2, borderRadius: radius.sm },
  chainOptionActive: { backgroundColor: colors.tealBg },
  swapBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.tealBg2, borderWidth: 1, borderColor: colors.tealBorder, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },

  amountHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
  balanceText:  { ...typography.xs, color: colors.textTertiary },
  amountBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.md, height: 60 },
  amountInput:  { flex: 1, ...typography.h3, color: colors.text, fontWeight: '700' as const, paddingVertical: 0 },
  amountSuffix: { ...typography.sm, color: colors.textTertiary, marginLeft: 4 },
  maxBtn:       { backgroundColor: colors.tealBg2, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md, marginLeft: spacing.sm },
  maxBtnText:   { ...typography.xs, color: colors.teal, fontWeight: '700' as const },

  addrBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.md, height: 56 },
  addrInput: { flex: 1, ...typography.body, color: colors.text, paddingVertical: 0 },

  infoBox:  { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.infoBg, padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.lg, alignItems: 'flex-start' },
  infoText: { ...typography.xs, color: colors.info, flex: 1, lineHeight: 18 },
});