import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { Header }     from '../../components/ui/Header';
import { Badge }      from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton }   from '../../components/ui/Skeleton';
import { TokenIcon }  from '../../components/ui/TokenIcon';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import type { RootState } from '../../store';

const ALL_TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;
type TokenSymbol = typeof ALL_TOKENS[number];

export default function TransactionsScreen() {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const { activeWalletIndex } = useSelector((s: RootState) => s.wallet);

  // If navigated from TokenDetail, start with only that token active
  const initialToken: TokenSymbol | undefined = route.params?.filterToken;

  // Token toggles — all on by default unless a specific token was passed
  const [activeTokens, setActiveTokens] = useState<Set<TokenSymbol>>(
    initialToken
      ? new Set([initialToken])
      : new Set(ALL_TOKENS)
  );

  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page,       setPage]       = useState(1);
  const [hasMore,    setHasMore]    = useState(true);

  const load = useCallback(async (pageNum = 1, append = false) => {
    try {
      // Pass the active wallet — previously this always fetched wallet 0's
      // transactions no matter which wallet was selected in the app.
      const res  = await api.getTransactions(pageNum, 20, activeWalletIndex);
      const data = res.data ?? res.transactions ?? res ?? [];
      const arr  = Array.isArray(data) ? data : [];
      setTransactions(prev => append ? [...prev, ...arr] : arr);
      setHasMore(arr.length === 20);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [activeWalletIndex]);

  // Reload on focus AND whenever the active wallet changes.
  useFocusEffect(
    useCallback(() => {
      setPage(1);
      load(1);
    }, [load])
  );

  const onRefresh = () => { setRefreshing(true); setPage(1); load(1); };
  const loadMore  = () => {
    if (hasMore && !loading) { const n = page + 1; setPage(n); load(n, true); }
  };

  const toggleToken = (token: TokenSymbol) => {
    setActiveTokens(prev => {
      const next = new Set(prev);
      if (next.has(token)) {
        // Don't allow deselecting all — keep at least one active
        if (next.size === 1) return next;
        next.delete(token);
      } else {
        next.add(token);
      }
      return next;
    });
  };

  // Filter by active token toggles
  const filtered = transactions.filter(tx => {
    const sym = tx.tokenSymbol ?? tx.token ?? '';
    return activeTokens.has(sym as TokenSymbol);
  });

  const screenTitle = initialToken
    ? `${initialToken} Transactions`
    : 'Transactions';

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <Header title={screenTitle} showBack={!!initialToken} />

      {/* Token toggle chips */}
      <View style={styles.filterWrap}>
        {ALL_TOKENS.map(token => {
          const isOn = activeTokens.has(token);
          return (
            <TouchableOpacity
              key={token}
              style={[styles.tokenChip, isOn && styles.tokenChipOn]}
              onPress={() => toggleToken(token)}
              activeOpacity={0.7}
            >
              <TokenIcon token={token} size={18} />
              <Text style={[styles.tokenChipText, isOn && styles.tokenChipTextOn]}>
                {token}
              </Text>
              {isOn && (
                <Ionicons name="checkmark" size={13} color={colors.teal} />
              )}
            </TouchableOpacity>
          );
        })}

        {/* "All" shortcut */}
        <TouchableOpacity
          style={[styles.allChip, activeTokens.size === ALL_TOKENS.length && styles.allChipOn]}
          onPress={() => setActiveTokens(new Set(ALL_TOKENS))}
          activeOpacity={0.7}
        >
          <Text style={[styles.tokenChipText, activeTokens.size === ALL_TOKENS.length && styles.tokenChipTextOn]}>
            All
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.skeletons}>
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} width="100%" height={68} />
          ))}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.teal}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title="No transactions"
              subtitle="Your activity will show up here"
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('TransactionDetail', { id: item.id })}
              activeOpacity={0.7}
            >
              <View style={[styles.txIcon, { backgroundColor: getIconBg(item.type) }]}>
                <Ionicons
                  name={getIcon(item.type) as any}
                  size={18}
                  color={getIconColor(item.type)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txTitle}>
                  {getLabel(item.type)} {item.tokenSymbol}
                </Text>
                <Text style={styles.txSubtitle}>
                  {item.chain?.toUpperCase()} · {new Date(item.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.txAmount, { color: getIconColor(item.type) }]}>
                  {item.type === 'SEND' ? '-' : '+'}{parseFloat(item.amount ?? '0').toFixed(2)}
                </Text>
                <Badge
                  label={item.status}
                  variant={
                    item.status === 'CONFIRMED' ? 'success'
                    : item.status === 'PENDING'  ? 'warning'
                    : 'error'
                  }
                />
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function getIcon(t: string) {
  if (t === 'SEND')            return 'arrow-up';
  if (t === 'RECEIVE')         return 'arrow-down';
  if (t?.startsWith('BRIDGE')) return 'swap-horizontal';
  if (t === 'MINT')            return 'add-circle-outline';
  if (t === 'BURN')            return 'flame-outline';
  return 'sync';
}
function getIconColor(t: string) {
  if (t === 'SEND')    return colors.error;
  if (t === 'MINT')    return colors.teal;
  if (t === 'RECEIVE') return colors.success;
  return colors.info;
}
function getIconBg(t: string) {
  if (t === 'SEND')    return colors.errorBg;
  if (t === 'MINT')    return colors.tealBg;
  if (t === 'RECEIVE') return colors.successBg;
  return colors.infoBg;
}
function getLabel(t: string) {
  const map: Record<string, string> = {
    SEND: 'Sent', RECEIVE: 'Received',
    BRIDGE_LOCK: 'Bridge Out', BRIDGE_MINT: 'Bridge In',
    MINT: 'Minted', BURN: 'Burned',
  };
  return map[t] ?? t;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  filterWrap: {
    flexDirection:  'row',
    alignItems:     'center',
    flexWrap:       'wrap',
    gap:            spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop:     spacing.md,
    paddingBottom:  spacing.sm,
  },

  tokenChip: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius:    radius.full,
    backgroundColor: colors.surface,
    borderWidth:     1.5,
    borderColor:     colors.border,
  },
  tokenChipOn: {
    backgroundColor: colors.tealBg,
    borderColor:     colors.tealBorder,
  },
  tokenChipText:   { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },
  tokenChipTextOn: { color: colors.teal },

  allChip: {
    paddingHorizontal: 14,
    paddingVertical:   8,
    borderRadius:      radius.full,
    backgroundColor:   colors.surface,
    borderWidth:       1.5,
    borderColor:       colors.border,
  },
  allChipOn: {
    backgroundColor: colors.tealBg2,
    borderColor:     colors.tealBorder,
  },

  skeletons:   { paddingHorizontal: spacing.xl, gap: spacing.sm, paddingTop: spacing.sm },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 100 },

  row: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              spacing.md,
    paddingVertical:  spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  txIcon:     { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  txTitle:    { ...typography.h5, color: colors.text },
  txSubtitle: { ...typography.xs, color: colors.textTertiary, marginTop: 2 },
  txAmount:   { ...typography.sm, fontWeight: '700' as const },
});