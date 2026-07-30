import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Platform, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { Button }    from '../../components/ui/Button';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import { fetchBalances } from '../../store/slices/walletSlice';
import type { AppDispatch, RootState } from '../../store';

const TAB_H = Platform.OS === 'ios' ? 84 : 68;
type Step  = 'form' | 'confirm' | 'processing' | 'success' | 'failed';

interface SwapNetwork { id: string; label: string; deployed: boolean; note?: string }
const TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;
const TOKEN_NAME: Record<string, string> = { INRX: 'e-Rupee', EGOLD: 'e-Gold', ESLVR: 'e-Silver' };

// Deliberately local to this screen rather than a shared component — it
// represents a NETWORK (Sepolia/BSC Testnet/etc), not a swappable token, so
// it doesn't belong in TokenIcon.tsx. Add a network in network-registry.ts
// on the backend and one line here to give it a colour.
const NETWORK_COLOR: Record<string, string> = {
  ethereum: '#627EEA', bsc: '#F0B90B', polygon: '#8247E5', tron: '#EF0027', solana: '#9945FF',
};
function NetworkIcon({ id, size = 26 }: { id?: string; size?: number }) {
  const color = (id && NETWORK_COLOR[id]) || colors.textSecondary;
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color + '22', borderWidth: 1, borderColor: color + '55',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <View style={{ width: size * 0.42, height: size * 0.42, borderRadius: size * 0.21, backgroundColor: color }} />
    </View>
  );
}

const QUOTE_DEBOUNCE_MS = 500;
const QUOTE_REFRESH_MS  = 10_000; // keep the rate "live" while the form sits idle

export default function SwapScreen() {
  const navigation = useNavigation<any>();
  const insets      = useSafeAreaInsets();
  const footerPb    = insets.bottom > 0 ? insets.bottom + 8 : TAB_H + 8;
  const dispatch    = useDispatch<AppDispatch>();

  const { balances, activeWalletIndex } = useSelector((s: RootState) => s.wallet);

  useFocusEffect(useCallback(() => { dispatch(fetchBalances(activeWalletIndex)); }, [dispatch, activeWalletIndex]));

  // ── Networks (from GET /swap/networks) ────────────────────────────────────
  const [networks, setNetworks] = useState<SwapNetwork[]>([]);
  const [network, setNetwork]   = useState<SwapNetwork | null>(null);
  const [networkPickerOpen, setNetworkPickerOpen] = useState(false);

  useEffect(() => {
    api.getSwapNetworks().then((list: SwapNetwork[]) => {
      setNetworks(list);
      setNetwork(list.find(n => n.deployed) ?? list[0] ?? null);
    }).catch(() => {
      // Fall back to the 4 networks we know are deployed if swap-service
      // happens to be unreachable when this loads.
      const fallback: SwapNetwork[] = [
        { id: 'polygon',  label: 'Polygon Amoy', deployed: true },
        { id: 'ethereum', label: 'Sepolia',      deployed: true },
        { id: 'bsc',      label: 'BSC Testnet',  deployed: true },
        { id: 'tron',     label: 'Tron Nile',    deployed: true },
      ];
      setNetworks(fallback);
      setNetwork(fallback[0]);
    });
  }, []);

  const [fromToken, setFromToken] = useState<typeof TOKENS[number]>('INRX');
  const [toToken,   setToToken]   = useState<typeof TOKENS[number]>('EGOLD');
  const [fromPickerOpen, setFromPickerOpen] = useState(false);
  const [toPickerOpen,   setToPickerOpen]   = useState(false);

  const [amount, setAmount] = useState('');
  const [step, setStep]     = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // ── Quote ────────────────────────────────────────────────────────────────
  const [quote, setQuote]           = useState<any>(null);
  const [quoting, setQuoting]       = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer  = useRef<ReturnType<typeof setInterval> | null>(null);

  const runQuote = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!network || !(amt > 0) || fromToken === toToken) { setQuote(null); return; }
    setQuoting(true);
    try {
      const q = await api.getSwapQuote({
        network: network.id, fromToken, toToken, amount, walletIndex: activeWalletIndex,
      });
      setQuote(q);
      setQuoteError('');
    } catch (err: any) {
      setQuoteError(err?.response?.data?.message ?? 'Could not get a quote right now');
      setQuote(null);
    } finally {
      setQuoting(false);
    }
  }, [network, fromToken, toToken, amount, activeWalletIndex]);

  useEffect(() => {
    setQuote(null);
    setQuoteError('');
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (refreshTimer.current)  clearInterval(refreshTimer.current);

    const amt = parseFloat(amount);
    if (!network || !(amt > 0) || fromToken === toToken) return;

    debounceTimer.current = setTimeout(() => {
      runQuote();
      refreshTimer.current = setInterval(runQuote, QUOTE_REFRESH_MS);
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (refreshTimer.current)  clearInterval(refreshTimer.current);
    };
  }, [network, fromToken, toToken, amount]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromBalance = network
    ? (balances ?? []).find((b: any) => b.symbol === fromToken && b.chain === network.id)
    : null;
  const toBalance = network
    ? (balances ?? []).find((b: any) => b.symbol === toToken && b.chain === network.id)
    : null;
  const availableBalance = parseFloat(fromBalance?.balance ?? '0');

  const flipTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount('');
  };

  const setPct = (pct: number) => {
    if (!availableBalance) return;
    setAmount(((availableBalance * pct) / 100).toFixed(6).replace(/\.?0+$/, ''));
  };

  const canReview = !!quote && !quoting && !!amount && parseFloat(amount) > 0 && fromToken !== toToken;

  const handleConfirm = async () => {
    if (!quote) return;
    setLoading(true);
    setStep('processing');
    try {
      await api.executeSwap(quote.quoteId);
      dispatch(fetchBalances(activeWalletIndex));
      setStep('success');
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message ?? 'The swap could not be completed. Check your balance and try again.');
      setStep('failed');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep('form');
    setAmount('');
    setQuote(null);
    setErrorMsg('');
  };

  // ── Processing / Success / Failed ────────────────────────────────────────
  if (step === 'processing') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.centerFlex}>
          <View style={styles.statusIcon}><ActivityIndicator color={colors.teal} size="large" /></View>
          <Text style={typography.h2}>Swapping</Text>
          <Text style={styles.statusDesc}>{amount} {fromToken} → {toToken}{'\n'}This won't take long.</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (step === 'success') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.centerFlex}>
          <View style={styles.statusIcon}><Ionicons name="checkmark" size={36} color={colors.teal} /></View>
          <Text style={typography.h2}>Swap Complete</Text>
          <Text style={styles.statusDesc}>{amount} {fromToken} became {quote?.to?.amount} {toToken}.</Text>
        </View>
        <View style={[styles.footer, { paddingBottom: footerPb }]}>
          <Button label="Done" onPress={() => { resetForm(); navigation.navigate('Dashboard'); }} />
        </View>
      </SafeAreaView>
    );
  }
  if (step === 'failed') {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.centerFlex}>
          <View style={[styles.statusIcon, styles.failIcon]}><Ionicons name="close" size={36} color={colors.error} /></View>
          <Text style={typography.h2}>Swap Failed</Text>
          <Text style={styles.statusDesc}>{errorMsg}</Text>
        </View>
        <View style={[styles.footer, { paddingBottom: footerPb }]}>
          <Button label="Try Again" onPress={resetForm} />
        </View>
      </SafeAreaView>
    );
  }
  if (step === 'confirm' && quote && network) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ScreenHeader title="Confirm Swap" onBack={() => setStep('form')} />
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.confirmCard}>
              <View style={styles.confirmRow}>
                <TokenIcon token={fromToken} size={36} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.confirmAmt}>{amount} {fromToken}</Text>
                  <Text style={styles.confirmSub}>{network.label}</Text>
                </View>
              </View>
              <View style={styles.confirmArrow}><Ionicons name="arrow-down" size={18} color={colors.textTertiary} /></View>
              <View style={styles.confirmRow}>
                <TokenIcon token={toToken} size={36} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.confirmAmt}>{quote.to.amount} {toToken}</Text>
                  <Text style={styles.confirmSub}>{network.label}</Text>
                </View>
              </View>
            </View>

            <View style={styles.rateBox}>
              <View style={styles.rateLine}>
                <Text style={styles.rateLabel}>Rate</Text>
                <Text style={styles.rateValue}>1 {fromToken} ≈ {quote.rate} {toToken}</Text>
              </View>
              <View style={styles.rateLine}>
                <Text style={styles.rateLabel}>Fee ({(quote.feeBps / 100).toFixed(2)}%)</Text>
                <Text style={styles.rateValue}>${quote.feeUsd}</Text>
              </View>
            </View>

            <View style={styles.infoBox}>
              <Ionicons name="time-outline" size={15} color={colors.info} />
              <Text style={styles.infoText}>This rate is locked briefly. If it expires, just go back and get a fresh quote.</Text>
            </View>
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: footerPb }]}>
            <Button label="Confirm Swap" onPress={handleConfirm} loading={loading} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScreenHeader title="Swap" onBack={() => navigation.goBack()} onHistory={() => navigation.navigate('SwapHistory')} />
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Network */}
          <Text style={styles.fieldLabel}>NETWORK</Text>
          <TouchableOpacity style={styles.networkPill} onPress={() => setNetworkPickerOpen(true)} activeOpacity={0.75}>
            <NetworkIcon id={network?.id} size={26} />
            <Text style={styles.networkPillText}>{network?.label ?? 'Select network'}</Text>
            <Ionicons name="chevron-down" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <View style={styles.sameNetworkBadge}>
            <Ionicons name="shield-checkmark-outline" size={13} color={colors.textTertiary} />
            <Text style={styles.sameNetworkText}>Same network swap only</Text>
          </View>

          {/* You Pay */}
          <View style={styles.card}>
            <View style={styles.cardHeadRow}>
              <Text style={styles.cardLabel}>You Pay</Text>
              <Text style={styles.balanceText}>Balance: {availableBalance.toFixed(2)} {fromToken}</Text>
            </View>
            <View style={styles.payRow}>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textTertiary}
              />
              <TouchableOpacity style={styles.tokenPill} onPress={() => setFromPickerOpen(true)} activeOpacity={0.75}>
                <TokenIcon token={fromToken} size={22} />
                <Text style={styles.tokenPillText}>{fromToken}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
            {quote && (
              <Text style={styles.usdLine}>≈ ${(parseFloat(amount || '0') * quote.from.priceUsd).toFixed(2)}</Text>
            )}
            <View style={styles.pctRow}>
              {[25, 50, 100].map(p => (
                <TouchableOpacity key={p} style={styles.pctBtn} onPress={() => setPct(p)} activeOpacity={0.7}>
                  <Text style={styles.pctBtnText}>{p === 100 ? 'MAX' : `${p}%`}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Flip */}
          <TouchableOpacity style={styles.flipBtn} onPress={flipTokens} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
            <Ionicons name="swap-vertical" size={18} color={colors.teal} />
          </TouchableOpacity>

          {/* You Receive */}
          <View style={styles.card}>
            <View style={styles.cardHeadRow}>
              <Text style={styles.cardLabel}>You Receive</Text>
              <Text style={styles.balanceText}>Balance: {parseFloat(toBalance?.balance ?? '0').toFixed(2)} {toToken}</Text>
            </View>
            <View style={styles.payRow}>
              {quoting ? (
                <ActivityIndicator size="small" color={colors.teal} style={{ marginLeft: 4 }} />
              ) : (
                <Text style={[styles.amountInput, !quote && { color: colors.textTertiary }]}>
                  {quote ? quote.to.amount : '0'}
                </Text>
              )}
              <TouchableOpacity style={styles.tokenPill} onPress={() => setToPickerOpen(true)} activeOpacity={0.75}>
                <TokenIcon token={toToken} size={22} />
                <Text style={styles.tokenPillText}>{toToken}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
            {quote && (
              <Text style={styles.usdLine}>≈ ${(parseFloat(quote.to.amount) * quote.to.priceUsd).toFixed(2)}</Text>
            )}
          </View>

          {quoteError ? (
            <View style={[styles.infoBox, styles.errorInfoBox]}>
              <Ionicons name="alert-circle-outline" size={15} color={colors.error} />
              <Text style={[styles.infoText, { color: colors.error }]}>{quoteError}</Text>
            </View>
          ) : quote ? (
            <View style={styles.rateRow}>
              <Ionicons name="trending-up-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.rateRowText}>1 {fromToken} = {quote.rate} {toToken}</Text>
              <Text style={styles.rateRowSub}>Rate updates in real-time</Text>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          ) : null}

          <View style={styles.infoBox}>
            <Ionicons name="shield-checkmark-outline" size={15} color={colors.teal} />
            <Text style={[styles.infoText, { color: colors.teal }]}>
              Swaps occur instantly between INRX, EGOLD and ESLVR on the same network{network ? ` (${network.label})` : ''}.
            </Text>
          </View>

          <View style={{ height: spacing.xl }} />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: footerPb }]}>
          <Button label="Swap Now" onPress={() => setStep('confirm')} disabled={!canReview} />
        </View>
      </View>

      {/* Network picker */}
      <PickerModal
        visible={networkPickerOpen}
        onClose={() => setNetworkPickerOpen(false)}
        title="Select network"
      >
        {networks.map(n => (
          <TouchableOpacity
            key={n.id}
            style={[styles.pickerRow, !n.deployed && styles.pickerRowDisabled]}
            disabled={!n.deployed}
            onPress={() => { setNetwork(n); setNetworkPickerOpen(false); }}
            activeOpacity={0.7}
          >
            <NetworkIcon id={n.id} size={30} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.pickerRowText}>{n.label}</Text>
              {!n.deployed && <Text style={styles.pickerRowNote}>{n.note ?? 'Coming soon'}</Text>}
            </View>
            {network?.id === n.id && <Ionicons name="checkmark-circle" size={20} color={colors.teal} />}
          </TouchableOpacity>
        ))}
      </PickerModal>

      {/* From token picker */}
      <PickerModal visible={fromPickerOpen} onClose={() => setFromPickerOpen(false)} title="You Pay">
        {TOKENS.filter(t => t !== toToken).map(t => (
          <TouchableOpacity key={t} style={styles.pickerRow} onPress={() => { setFromToken(t); setFromPickerOpen(false); }} activeOpacity={0.7}>
            <TokenIcon token={t} size={30} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.pickerRowText}>{t}</Text>
              <Text style={styles.pickerRowNote}>{TOKEN_NAME[t]}</Text>
            </View>
            {fromToken === t && <Ionicons name="checkmark-circle" size={20} color={colors.teal} />}
          </TouchableOpacity>
        ))}
      </PickerModal>

      {/* To token picker */}
      <PickerModal visible={toPickerOpen} onClose={() => setToPickerOpen(false)} title="You Receive">
        {TOKENS.filter(t => t !== fromToken).map(t => (
          <TouchableOpacity key={t} style={styles.pickerRow} onPress={() => { setToToken(t); setToPickerOpen(false); }} activeOpacity={0.7}>
            <TokenIcon token={t} size={30} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.pickerRowText}>{t}</Text>
              <Text style={styles.pickerRowNote}>{TOKEN_NAME[t]}</Text>
            </View>
            {toToken === t && <Ionicons name="checkmark-circle" size={20} color={colors.teal} />}
          </TouchableOpacity>
        ))}
      </PickerModal>
    </SafeAreaView>
  );
}

// Simple header: back arrow, centered title, optional history icon — matches
// the rest of the app's screens closely enough without pulling in the
// heavier <Header> component (which assumes a subtitle row we don't want here).
function ScreenHeader({ title, onBack, onHistory }: { title: string; onBack: () => void; onHistory?: () => void }) {
  return (
    <View style={styles.screenHeader}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="arrow-back" size={22} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.screenHeaderTitle}>{title}</Text>
      {onHistory ? (
        <TouchableOpacity onPress={onHistory} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="time-outline" size={22} color={colors.text} />
        </TouchableOpacity>
      ) : <View style={{ width: 22 }} />}
    </View>
  );
}

function PickerModal({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.modalSheet} onPress={() => {}}>
          <Text style={styles.modalTitle}>{title}</Text>
          {children}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex:       { flex: 1, backgroundColor: colors.bg },
  centerFlex: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  content:    { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  footer:     { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },

  screenHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  screenHeaderTitle: { ...typography.h4, color: colors.text },

  statusIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.tealBg2, borderWidth: 1, borderColor: colors.tealBorder, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  failIcon:   { backgroundColor: colors.errorBg, borderColor: colors.error + '40' },
  statusDesc: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 22 },

  fieldLabel: { ...typography.xs, color: colors.textTertiary, fontWeight: '700' as const, letterSpacing: 0.5, marginBottom: spacing.sm },
  networkPill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.tealBorder,
    borderRadius: radius.full, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
  },
  networkPillText: { flex: 1, ...typography.h5, color: colors.text, fontWeight: '700' as const },

  sameNetworkBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.sm, marginBottom: spacing.lg },
  sameNetworkText:  { ...typography.xs, color: colors.textTertiary },

  card: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.sm },
  cardHeadRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardLabel:   { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },
  balanceText: { ...typography.xs, color: colors.textTertiary },

  payRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amountInput: { flex: 1, ...typography.display, fontSize: 32, color: colors.text, fontWeight: '700' as const, paddingVertical: 0 },
  usdLine: { ...typography.xs, color: colors.textTertiary, marginTop: 4 },

  tokenPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.tealBg2, borderRadius: radius.full, paddingVertical: 8, paddingHorizontal: 12 },
  tokenPillText: { ...typography.sm, color: colors.text, fontWeight: '700' as const },

  pctRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  pctBtn: { backgroundColor: colors.tealBg, borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: 12 },
  pctBtnText: { ...typography.xs, color: colors.teal, fontWeight: '700' as const },

  flipBtn: { alignSelf: 'center', width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tealBg2, borderWidth: 1, borderColor: colors.tealBorder, alignItems: 'center', justifyContent: 'center', marginVertical: -spacing.sm, zIndex: 1 },

  rateRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: spacing.lg, paddingHorizontal: 2 },
  rateRowText: { ...typography.xs, color: colors.textSecondary, fontWeight: '600' as const },
  rateRowSub:  { ...typography.xs, color: colors.textTertiary, flex: 1 },
  liveDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal },
  liveText:    { ...typography.xs, color: colors.teal, fontWeight: '700' as const },

  infoBox:      { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.tealBg, padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.lg, alignItems: 'flex-start' },
  errorInfoBox: { backgroundColor: colors.errorBg },
  infoText:     { ...typography.xs, color: colors.info, flex: 1, lineHeight: 18 },

  confirmCard: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  confirmRow:  { flexDirection: 'row', alignItems: 'center' },
  confirmArrow:{ alignItems: 'center', marginVertical: spacing.sm },
  confirmAmt:  { ...typography.h5, color: colors.text },
  confirmSub:  { ...typography.xs, color: colors.textTertiary, marginTop: 2 },

  rateBox:   { marginTop: spacing.lg, gap: spacing.sm },
  rateLine:  { flexDirection: 'row', justifyContent: 'space-between' },
  rateLabel: { ...typography.sm, color: colors.textTertiary },
  rateValue: { ...typography.sm, color: colors.text, fontWeight: '600' as const },

  modalBackdrop: { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
  modalSheet:    { backgroundColor: colors.surface, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.xl, paddingBottom: spacing.xxxl, borderTopWidth: 1, borderColor: colors.border },
  modalTitle:    { ...typography.h4, color: colors.text, marginBottom: spacing.lg },
  pickerRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerRowDisabled: { opacity: 0.4 },
  pickerRowText: { ...typography.h5, color: colors.text },
  pickerRowNote: { ...typography.xs, color: colors.textTertiary, marginTop: 2 },
});
