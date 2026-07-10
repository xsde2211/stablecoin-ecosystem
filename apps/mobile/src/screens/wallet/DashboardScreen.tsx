import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, StatusBar,
} from 'react-native';
import { LinearGradient }                from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useDispatch, useSelector }      from 'react-redux';
import { Ionicons }                      from '@expo/vector-icons';
import { TokenIcon }    from '../../components/ui/TokenIcon';
import { ChainBadge }   from '../../components/ui/ChainBadge';
import { Badge }        from '../../components/ui/Badge';
import { Skeleton }     from '../../components/ui/Skeleton';
import { colors, typography, spacing, radius, shadow } from '../../theme';
import { fetchBalances, fetchTransactions } from '../../store/slices/walletSlice';
import type { AppDispatch, RootState }      from '../../store';

const TOKEN_META: Record<string, { name: string; color: string }> = {
  INRX:  { name: 'e-Rupee',  color: colors.teal   },
  EGOLD: { name: 'e-Gold',   color: colors.gold   },
  ESLVR: { name: 'e-Silver', color: colors.silver },
};

function timeOfDay() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
function fmt(n: number) {
  if (!n || isNaN(n)) return '0.00';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
function shortAddr(s: string) {
  if (!s || s.length < 12) return s ?? '';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const dispatch   = useDispatch<AppDispatch>();
  const insets     = useSafeAreaInsets();
  const { balances, transactions, loading, activeWalletIndex } = useSelector((s: RootState) => s.wallet);
  const { user }   = useSelector((s: RootState) => s.auth);
  const [refreshing, setRefreshing] = useState(false);

  // Derive readable display name
  const displayName = (() => {
    if (!user) return 'Welcome';
    const u = user as any;
    // Prefer server-provided name fields
    if (u.fullName) return u.fullName.split(' ')[0]; // "Rahul Sharma" → "Rahul"
    if (u.name)     return u.name.split(' ')[0];
    // Derive from email: sourabhgupta1221@gmail.com → "Sourabh"
    const local = (u.email ?? '').split('@')[0] ?? '';
    // Strip numbers and punctuation
    const letters = local.replace(/[^a-zA-Z]/g, '');
    if (!letters) return 'Hi';
    // If camelCase (sourabhGupta), take first word; else take first 10 chars
    const camelSplit = letters.replace(/([a-z])([A-Z])/g, '$1 $2');
    const firstName  = camelSplit.split(' ')[0];
    // Capitalize only first letter, rest lowercase
    return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  })();

  const initial = displayName.charAt(0).toUpperCase();

  const load = useCallback(() => {
    dispatch(fetchBalances(activeWalletIndex));
    dispatch(fetchTransactions({ page: 1, limit: 5, walletIndex: activeWalletIndex }));
  }, [dispatch, activeWalletIndex]);

  // Refetch both on focus AND whenever the active wallet changes (e.g. the
  // user switches wallets in WalletManagerScreen and comes back here).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      dispatch(fetchBalances()),
      dispatch(fetchTransactions({ page: 1, limit: 5 })),
    ]);
    setRefreshing(false);
  };

  const aggregated = ['INRX', 'EGOLD', 'ESLVR'].map(sym => {
    const rows  = (balances ?? []).filter((b: any) => b.symbol === sym);
    const total = rows.reduce((s: number, r: any) => s + parseFloat(r.balance || '0'), 0);
    return { sym, total, chains: rows };
  });

  const portfolioINR = aggregated.reduce((sum, t) => {
    if (t.sym === 'INRX')  return sum + t.total;
    if (t.sym === 'EGOLD') return sum + t.total * 5900;
    if (t.sym === 'ESLVR') return sum + t.total * 75;
    return sum;
  }, 0);

  const recentTxs = (transactions ?? []).slice(0, 5);
  const isLoading = loading && aggregated.every(t => t.total === 0);

  return (
    // Dashboard owns its top inset directly (no Header component).
    // Use edges={['top']} so the status bar area is correctly padded.
    // The topBar uses insets.top for fine control.
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.teal}
            colors={[colors.teal]}
          />
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Top bar — no extra paddingTop needed because SafeAreaView edges={['top']} handles it */}
        <View style={styles.topBar}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Text style={styles.greeting}>Good {timeOfDay()}</Text>
            <Text style={styles.userName} numberOfLines={1}>{displayName}</Text>
          </View>
          <View style={styles.topRight}>
            <TouchableOpacity
              style={styles.topBtn}
              onPress={() => navigation.navigate('Notifications')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Ionicons name="notifications-outline" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.avatarBtn}
              onPress={() => navigation.navigate('ProfileTab')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Text style={styles.avatarText}>{initial}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Hero balance card */}
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={['#1A2235', '#0D1520']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroLabelRow}>
              <Text style={styles.heroLabel}>Total Portfolio Value</Text>
              <TouchableOpacity onPress={load} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="refresh-outline" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
            {isLoading ? (
              <Skeleton width={180} height={44} style={{ marginVertical: 8 }} />
            ) : (
              <Text style={styles.heroValue}>₹{fmt(portfolioINR)}</Text>
            )}
            <View style={styles.quickRow}>
              {[
                { icon: 'arrow-up-outline',       label: 'Send',    screen: 'Send'      },
                { icon: 'arrow-down-outline',      label: 'Receive', screen: 'Receive'   },
                { icon: 'swap-horizontal-outline', label: 'Bridge',  screen: 'BridgeTab' },
                { icon: 'qr-code-outline',         label: 'Pay',     screen: 'PayQR'     },
              ].map(a => (
                <TouchableOpacity
                  key={a.label}
                  style={styles.quickBtn}
                  onPress={() => navigation.navigate(a.screen as any)}
                  activeOpacity={0.7}
                >
                  <View style={styles.quickIcon}>
                    <Ionicons name={a.icon as any} size={20} color={colors.teal} />
                  </View>
                  <Text style={styles.quickLabel}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </LinearGradient>
        </View>

        {/* Assets */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Assets</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('TransactionTab')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.seeAll}>View all</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.assetList}>
          {isLoading ? (
            [1, 2, 3].map(i => (
              <Skeleton key={i} width="100%" height={72} style={{ marginBottom: spacing.sm }} />
            ))
          ) : (
            aggregated.map(t => (
              <TouchableOpacity
                key={t.sym}
                style={styles.assetRow}
                onPress={() => navigation.navigate('TokenDetail', { token: t.sym })}
                activeOpacity={0.75}
              >
                <TokenIcon token={t.sym} size={46} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.assetName}>{TOKEN_META[t.sym]?.name}</Text>
                  <View style={styles.chainRow}>
                    {t.chains.slice(0, 4).map((c: any) => (
                      <ChainBadge key={c.chain} chain={c.chain} size="xs" />
                    ))}
                    {t.chains.length === 0 && (
                      <Text style={styles.noBalance}>No balance yet</Text>
                    )}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.assetAmt}>{fmt(t.total)}</Text>
                  <Text style={styles.assetSym}>{t.sym}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Recent activity */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('TransactionTab')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.txList}>
          {isLoading ? (
            [1, 2, 3].map(i => (
              <Skeleton key={i} width="100%" height={60} style={{ marginBottom: spacing.xs }} />
            ))
          ) : recentTxs.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="receipt-outline" size={28} color={colors.textTertiary} />
              <Text style={styles.emptyText}>No transactions yet</Text>
              <Text style={styles.emptySubText}>Your activity will appear here</Text>
            </View>
          ) : (
            recentTxs.map((tx: any) => {
              const isSend   = tx.type === 'SEND';
              const isBridge = (tx.type ?? '').startsWith('BRIDGE');
              const iconName = isSend ? 'arrow-up' : isBridge ? 'swap-horizontal' : 'arrow-down';
              const iconBg   = isSend ? colors.errorBg : isBridge ? colors.tealBg : colors.successBg;
              const iconCol  = isSend ? colors.error   : isBridge ? colors.teal   : colors.success;
              const amtColor = isSend ? colors.error : colors.success;
              const sign     = isSend ? '-' : '+';
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
                    <Text style={styles.txTitle}>
                      {isSend ? 'Sent' : isBridge ? 'Bridged' : 'Received'} {tx.tokenSymbol}
                    </Text>
                    <Text style={styles.txMeta}>
                      {shortAddr(isSend ? tx.toAddress : tx.fromAddress)} · {timeAgo(tx.createdAt)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.txAmt, { color: amtColor }]}>
                      {sign}{fmt(parseFloat(tx.amount ?? '0'))}
                    </Text>
                    <Badge
                      label={tx.status}
                      variant={
                        tx.status === 'CONFIRMED' ? 'success'
                        : tx.status === 'PENDING' ? 'warning'
                        : 'error'
                      }
                    />
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingHorizontal: spacing.xl,
    paddingVertical:   spacing.md,
  },
  greeting:  { ...typography.xs, color: colors.textTertiary },
  userName:  { ...typography.h3, color: colors.text, marginTop: 2 },
  topRight:  { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  topBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.tealBg2, borderWidth: 1.5, borderColor: colors.teal,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '700' as const, color: colors.teal },

  heroWrap: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  heroCard: {
    borderRadius: radius.xxl, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.border, ...shadow.lg,
  },
  heroLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: spacing.xs,
  },
  heroLabel: { ...typography.sm, color: colors.textTertiary },
  heroValue: { ...typography.display, color: colors.text, marginBottom: spacing.xl },
  quickRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  quickBtn:  { alignItems: 'center', gap: spacing.xs, flex: 1 },
  quickIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.tealBg2, borderWidth: 1, borderColor: colors.tealBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  quickLabel: { ...typography.xs, color: colors.textSecondary, fontWeight: '600' as const },

  sectionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, marginTop: spacing.xl, marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.h4, color: colors.text },
  seeAll:       { ...typography.sm, color: colors.teal, fontWeight: '600' as const },

  assetList: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  assetRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, padding: spacing.md,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
  },
  assetName: { ...typography.h5, color: colors.text },
  chainRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  noBalance: { ...typography.xs, color: colors.textTertiary },
  assetAmt:  { ...typography.h5, color: colors.text },
  assetSym:  { ...typography.xs, color: colors.textTertiary, marginTop: 2 },

  txList:  { paddingHorizontal: spacing.xl, marginTop: spacing.xs },
  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  txIcon:     { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  txTitle:    { ...typography.sm, color: colors.text, fontWeight: '600' as const },
  txMeta:     { ...typography.xs, color: colors.textTertiary, marginTop: 2 },
  txAmt:      { ...typography.sm, fontWeight: '700' as const, marginBottom: 2 },
  emptyBox:   { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm },
  emptyText:  { ...typography.h5, color: colors.textSecondary },
  emptySubText: { ...typography.xs, color: colors.textTertiary },
});