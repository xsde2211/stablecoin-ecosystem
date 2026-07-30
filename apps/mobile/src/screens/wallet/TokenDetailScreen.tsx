import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { Header }    from '../../components/ui/Header';
import { Card }      from '../../components/ui/Card';
import { Badge }     from '../../components/ui/Badge';
import { Skeleton }  from '../../components/ui/Skeleton';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { ChainBadge }from '../../components/ui/ChainBadge';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import { fetchBalances } from '../../store/slices/walletSlice';
import type { AppDispatch, RootState } from '../../store';

const TOKEN_META: Record<string, { name: string; desc: string }> = {
  INRX:  { name: 'e-Rupee',  desc: '1 INRX = 1 Indian Rupee, backed by bank deposits & government securities' },
  EGOLD: { name: 'e-Gold',   desc: '1 eGold = 1 gram of physical gold, fully vaulted and audited' },
  ESLVR: { name: 'e-Silver', desc: '1 eSilver = 1 gram of physical silver, fully vaulted and audited' },
};

const CHAINS = ['ethereum', 'bsc', 'polygon', 'tron'];

function fmt(n: number, decimals = 2) {
  if (!n || isNaN(n)) return '0.00';
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}
function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function shortAddr(s?: string) {
  if (!s || s.length < 12) return s ?? '—';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export default function TokenDetailScreen() {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const token      = route.params?.token ?? 'INRX';
  const meta       = TOKEN_META[token] ?? { name: token, desc: '' };

  const dispatch = useDispatch<AppDispatch>();
  const { balances, activeWalletIndex } = useSelector((s: RootState) => s.wallet);
  const chainBalances = (balances ?? []).filter((b: any) => b.symbol === token);
  const totalBalance  = chainBalances.reduce(
    (sum: number, b: any) => sum + parseFloat(b.balance || '0'), 0
  );
  // valueUsd is per-chain-row from wallet-service (balance × today's live
  // price) — summing across rows gives this token's total current value;
  // dividing that by the total quantity gives the per-unit price, since
  // the price itself is the same across chains (only the row's own
  // balance differs).
  const totalValueUsd = chainBalances.reduce((sum: number, b: any) => sum + (b.valueUsd ?? 0), 0);
  const priceUsd = totalBalance > 0 && chainBalances.some((b: any) => b.valueUsd != null)
    ? totalValueUsd / totalBalance
    : null;

  const [chainInfo,   setChainInfo]   = useState<any[]>([]);
  const [reserve,     setReserve]     = useState<any>(null);
  const [recentTxs,   setRecentTxs]   = useState<any[]>([]);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [loadingTxs,  setLoadingTxs]  = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const loadInfo = useCallback(async () => {
    // Fetch token info for each chain using api.getTokenInfo(token, chain)
    const results = await Promise.allSettled(
      CHAINS.map(c => api.getTokenInfo(token, c))
    );
    const info = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value);
    setChainInfo(info);

    // Fetch proof of reserve — api.getProofOfReserve(token, chain)
    // Try each chain until one succeeds
    let reserveData = null;
    for (const c of CHAINS) {
      try {
        reserveData = await api.getProofOfReserve(token, c);
        if (reserveData) break;
      } catch {}
    }
    setReserve(reserveData);
    setLoadingInfo(false);
  }, [token]);

  const loadTxs = useCallback(async () => {
    try {
      const res  = await api.getTransactions(1, 50, activeWalletIndex);
      const data = res.data ?? res.transactions ?? res ?? [];
      const filtered = (Array.isArray(data) ? data : []).filter(
        (tx: any) => tx.tokenSymbol === token || tx.token === token
      );
      setRecentTxs(filtered.slice(0, 3));
    } catch { setRecentTxs([]); }
    setLoadingTxs(false);
  }, [token, activeWalletIndex]);

  // Re-run on focus AND whenever the active wallet changes, and also make
  // sure the shared `balances` (used above for totalBalance) reflect the
  // active wallet in case this screen is opened before Dashboard ever fetches.
  useFocusEffect(useCallback(() => {
    dispatch(fetchBalances(activeWalletIndex));
    loadInfo();
    loadTxs();
  }, [dispatch, activeWalletIndex, loadInfo, loadTxs]));

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadInfo(), loadTxs()]);
    setRefreshing(false);
  };

  // Sum on-chain supply across all chains
  const onChainSupply = chainInfo.reduce(
    (sum, c) => sum + parseFloat(c.totalSupply || '0'), 0
  );

  const reserveAmount = parseFloat(reserve?.reserveAmount ?? reserve?.totalReserve ?? '0');
  const ratio         = parseFloat(reserve?.collateralRatio ?? reserve?.backingRatio ?? '0');
  const isHealthy     = reserve?.isHealthy ?? reserve?.isFullyBacked ?? false;

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <Header title={meta.name} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />
        }
      >
        {/* Hero */}
        <View style={styles.hero}>
          <TokenIcon token={token} size={64} />
          <Text style={styles.heroBalance}>{fmt(totalBalance, 4)}</Text>
          <Text style={styles.heroSymbol}>{token}</Text>
          {priceUsd != null && (
            <View style={styles.priceBlock}>
              <Text style={styles.heroValueUsd}>≈ ${fmt(totalValueUsd)}</Text>
              <Text style={styles.heroPricePerUnit}>1 {token} = ${priceUsd.toFixed(4)}</Text>
            </View>
          )}
          <Text style={styles.heroDesc}>{meta.desc}</Text>
        </View>

        {/* Quick actions */}
        <View style={styles.actions}>
          {[
            { icon: 'arrow-up',        label: 'Send',    onPress: () => navigation.navigate('Send',    { token }) },
            { icon: 'arrow-down',      label: 'Receive', onPress: () => navigation.navigate('Receive', { token }) },
            { icon: 'swap-horizontal', label: 'Bridge',  onPress: () => navigation.navigate('BridgeTab') },
          ].map(a => (
            <TouchableOpacity key={a.label} style={styles.actionBtn} onPress={a.onPress} activeOpacity={0.7}>
              <View style={styles.actionIcon}>
                <Ionicons name={a.icon as any} size={20} color={colors.teal} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Balance by network */}
        <Text style={styles.sectionTitle}>Balance by Network</Text>
        <Card>
          {chainBalances.length === 0 ? (
            <Text style={styles.emptyText}>No balance on any network yet</Text>
          ) : (
            chainBalances.map((b: any, i: number) => (
              <View key={b.chain} style={[styles.chainRow, i < chainBalances.length - 1 && styles.rowBorder]}>
                <ChainBadge chain={b.chain} />
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.chainBal}>
                    {fmt(parseFloat(b.balance || '0'), 4)} {token}
                  </Text>
                  {b.valueUsd != null && (
                    <Text style={styles.chainBalUsd}>≈ ${fmt(b.valueUsd)}</Text>
                  )}
                </View>
              </View>
            ))
          )}
        </Card>

        {/* Proof of Reserve */}
        <Text style={styles.sectionTitle}>Proof of Reserve</Text>
        {loadingInfo ? (
          <Skeleton width="100%" height={160} style={{ borderRadius: radius.xl }} />
        ) : (
          <Card>
            <View style={[styles.reserveRow, styles.rowBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reserveLabel}>On-Chain Supply</Text>
                <Text style={styles.reserveNote}>Live from smart contract</Text>
              </View>
              <Text style={styles.reserveValue}>{fmt(onChainSupply)} {token}</Text>
            </View>
            <View style={[styles.reserveRow, styles.rowBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reserveLabel}>Total Reserve</Text>
                <Text style={styles.reserveNote}>Backing assets in custody</Text>
              </View>
              <Text style={styles.reserveValue}>{fmt(reserveAmount)} {token}</Text>
            </View>
            <View style={[styles.reserveRow, styles.rowBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reserveLabel}>Backing Ratio</Text>
                <Text style={styles.reserveNote}>Reserve ÷ Circulating supply</Text>
              </View>
              <Text style={[styles.reserveValue, { color: ratio >= 1 ? colors.success : colors.warning }]}>
                {ratio === 0 ? '—' : (ratio * 100).toFixed(1) + '%'}
              </Text>
            </View>
            <View style={styles.reserveRow}>
              <Text style={styles.reserveLabel}>Status</Text>
              <Badge
                label={isHealthy ? 'Fully Backed ✓' : reserveAmount === 0 ? 'Pending Setup' : 'Under-collateralized'}
                variant={isHealthy ? 'success' : 'warning'}
              />
            </View>
          </Card>
        )}

        {/* Reserve info box - explains 0 values */}
        {!loadingInfo && reserveAmount === 0 && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.info} />
            <Text style={styles.infoText}>
              Reserve shows 0 because no reserve entry has been recorded yet. In production this updates automatically when users fund their wallets via Razorpay. On-chain supply above shows the real minted tokens.
            </Text>
          </View>
        )}

        {/* Recent transactions - latest 3 for this token */}
        <View style={styles.txHeader}>
          <Text style={styles.sectionTitle}>Recent {token} Activity</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('TransactionTab', {
              screen: 'Transactions',
              params: { filterToken: token },
            })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Text style={styles.viewAll}>View all</Text>
          </TouchableOpacity>
        </View>

        {loadingTxs ? (
          [1, 2, 3].map(i => (
            <Skeleton key={i} width="100%" height={64} style={{ marginBottom: spacing.sm }} />
          ))
        ) : recentTxs.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
            <Ionicons name="receipt-outline" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No {token} transactions yet</Text>
          </Card>
        ) : (
          <>
            {recentTxs.map((tx: any) => {
              const isSend   = tx.type === 'SEND';
              const isMint   = tx.type === 'MINT';
              const isBridge = (tx.type ?? '').startsWith('BRIDGE');
              const iconName = isSend ? 'arrow-up' : isBridge ? 'swap-horizontal' : isMint ? 'add-circle-outline' : 'arrow-down';
              const iconBg   = isSend ? colors.errorBg : isMint ? colors.tealBg : isBridge ? colors.infoBg : colors.successBg;
              const iconCol  = isSend ? colors.error   : isMint ? colors.teal   : isBridge ? colors.info   : colors.success;
              const amtColor = isSend ? colors.error : colors.success;
              const sign     = isSend ? '-' : '+';
              const label    = isSend ? 'Sent' : isMint ? 'Minted' : isBridge ? 'Bridged' : 'Received';

              return (
                <TouchableOpacity
                  key={tx.id}
                  style={styles.txRow}
                  onPress={() => navigation.navigate('TransactionDetail', { id: tx.id })}
                  activeOpacity={0.7}
                >
                  <View style={[styles.txIcon, { backgroundColor: iconBg }]}>
                    <Ionicons name={iconName as any} size={16} color={iconCol} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txTitle}>{label} {token}</Text>
                    <Text style={styles.txMeta}>
                      {shortAddr(isSend ? tx.toAddress : tx.fromAddress)}
                      {' · '}{timeAgo(tx.createdAt)}
                      {' · '}{tx.chain?.toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.txAmt, { color: amtColor }]}>
                      {sign}{fmt(parseFloat(tx.amount ?? '0'))}
                    </Text>
                    <Badge
                      label={tx.status}
                      variant={tx.status === 'CONFIRMED' ? 'success' : tx.status === 'PENDING' ? 'warning' : 'error'}
                    />
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* View all button */}
            <TouchableOpacity
              style={styles.viewAllBtn}
              onPress={() => navigation.navigate('TransactionTab', {
                screen: 'Transactions',
                params: { filterToken: token },
              })}
              activeOpacity={0.7}
            >
              <Text style={styles.viewAllBtnText}>View all {token} transactions</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.teal} />
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content:   { paddingHorizontal: spacing.xl, paddingTop: spacing.md },

  hero:        { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  heroBalance: { ...typography.h1, fontSize: 40, color: colors.text, marginTop: spacing.sm },
  heroSymbol:  { ...typography.sm, color: colors.textTertiary },
  priceBlock:  { alignItems: 'center', gap: 2, marginTop: 2 },
  heroValueUsd:     { ...typography.h5, color: colors.teal, fontWeight: '700' as const },
  heroPricePerUnit: { ...typography.xs, color: colors.textTertiary },
  heroDesc:    { ...typography.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.lg },

  actions:    { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  actionBtn:  { flex: 1, alignItems: 'center', gap: spacing.sm },
  actionIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.tealBg2, borderWidth: 1, borderColor: colors.tealBorder, alignItems: 'center', justifyContent: 'center' },
  actionLabel:{ ...typography.xs, color: colors.textSecondary, fontWeight: '600' as const },

  sectionTitle:{ ...typography.h4, color: colors.text, marginBottom: spacing.md, marginTop: spacing.lg },

  chainRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  chainBal:  { ...typography.sm, color: colors.text, fontWeight: '700' as const },
  chainBalUsd: { ...typography.xs, color: colors.textTertiary, marginTop: 2 },

  reserveRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  reserveLabel: { ...typography.sm, color: colors.text, fontWeight: '600' as const },
  reserveNote:  { ...typography.xs, color: colors.textTertiary, marginTop: 2 },
  reserveValue: { ...typography.sm, color: colors.text, fontWeight: '700' as const },

  infoBox: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.infoBg, padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.info + '30' },
  infoText:{ ...typography.xs, color: colors.info, flex: 1, lineHeight: 18 },

  txHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.md },
  viewAll:     { ...typography.sm, color: colors.teal, fontWeight: '600' as const },

  txRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  txIcon:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  txTitle:  { ...typography.sm, color: colors.text, fontWeight: '600' as const },
  txMeta:   { ...typography.xs, color: colors.textTertiary, marginTop: 2 },
  txAmt:    { ...typography.sm, fontWeight: '700' as const, marginBottom: 2 },

  viewAllBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.tealBg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.tealBorder },
  viewAllBtnText: { ...typography.sm, color: colors.teal, fontWeight: '700' as const },

  emptyText: { ...typography.sm, color: colors.textTertiary, marginTop: spacing.sm, textAlign: 'center' },
});