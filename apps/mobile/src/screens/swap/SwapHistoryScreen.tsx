import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

// swap-service records TWO Transaction rows per swap (the burn leg OUT and
// the mint leg IN, sharing metadata.direction) — this groups them back into
// one row per swap for display, keyed by the OUT leg's txHash (its
// metadata.counterpart tells us the IN leg's token/amount directly, so we
// don't need to actually match the two rows up).
function groupSwaps(rows: any[]) {
  return rows
    .filter(r => r.metadata?.direction === 'OUT')
    .map(r => ({
      id:        r.id,
      network:   r.chain,
      fromToken: r.tokenSymbol,
      fromAmount:r.amount,
      toToken:   r.metadata?.counterpart?.token,
      toAmount:  r.metadata?.counterpart?.amount,
      createdAt: r.createdAt,
      status:    r.status,
    }));
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

export default function SwapHistoryScreen() {
  const navigation = useNavigation<any>();
  const [swaps, setSwaps]         = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getSwapHistory(1, 30);
      setSwaps(groupSwaps(res.data ?? []));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Swap History</Text>
        <View style={{ width: 22 }} />
      </View>

      <FlatList
        data={swaps}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} colors={[colors.teal]} />}
        ListEmptyComponent={!loading ? (
          <View style={styles.emptyBox}>
            <Ionicons name="repeat-outline" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No swaps yet</Text>
            <Text style={styles.emptySubText}>Your swap history will show up here</Text>
          </View>
        ) : null}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.tokenStack}>
              <TokenIcon token={item.fromToken} size={30} />
              <View style={styles.tokenStackOverlap}><TokenIcon token={item.toToken} size={30} /></View>
            </View>
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.rowTitle}>{item.fromToken} → {item.toToken}</Text>
              <Text style={styles.rowMeta}>{item.network} · {timeAgo(item.createdAt)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.rowAmt}>-{item.fromAmount} {item.fromToken}</Text>
              <Text style={styles.rowAmtIn}>+{item.toAmount} {item.toToken}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  headerTitle: { ...typography.h4, color: colors.text },

  listContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tokenStack: { flexDirection: 'row', width: 44 },
  tokenStackOverlap: { marginLeft: -14, borderRadius: 15, borderWidth: 2, borderColor: colors.bg },
  rowTitle: { ...typography.sm, color: colors.text, fontWeight: '600' as const },
  rowMeta:  { ...typography.xs, color: colors.textTertiary, marginTop: 2 },
  rowAmt:   { ...typography.sm, color: colors.error, fontWeight: '700' as const },
  rowAmtIn: { ...typography.xs, color: colors.success, marginTop: 2, fontWeight: '600' as const },

  emptyBox: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm },
  emptyText: { ...typography.h5, color: colors.textSecondary },
  emptySubText: { ...typography.xs, color: colors.textTertiary },
});
