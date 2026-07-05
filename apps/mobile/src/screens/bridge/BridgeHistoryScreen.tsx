import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/ui/Header';
import { Badge }  from '../../components/ui/Badge';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

const STATUS_VARIANT: Record<string, any> = {
  PENDING: 'warning', LOCKED: 'warning', SIGNATURES_COLLECTED: 'info',
  MINTED: 'info', COMPLETED: 'success', FAILED: 'error', EXPIRED: 'error',
};

export default function BridgeHistoryScreen() {
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getBridgeHistory(1);
      setTransfers(res.data ?? []);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); load(); };

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <Header title="Bridge History" />
      {loading ? (
        <View style={styles.skeletonWrap}>
          {[1, 2, 3].map(i => <Skeleton key={i} width="100%" height={88} />)}
        </View>
      ) : (
        <FlatList
          data={transfers}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
          ListEmptyComponent={<EmptyState icon="swap-horizontal-outline" title="No bridge transfers" subtitle="Cross-chain transfers will appear here" />}
          renderItem={({ item }) => {
            const isExpanded = expanded === item.id;
            return (
              <TouchableOpacity style={styles.card} onPress={() => setExpanded(isExpanded ? null : item.id)} activeOpacity={0.7}>
                <View style={styles.cardHeader}>
                  <View style={styles.routeRow}>
                    <ChainBadge chain={item.srcChain} />
                    <Ionicons name="arrow-forward" size={14} color={colors.textTertiary} />
                    <ChainBadge chain={item.dstChain} />
                  </View>
                  <Badge label={item.status?.replace('_', ' ')} variant={STATUS_VARIANT[item.status] ?? 'default'} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.amount}>{parseFloat(item.amount).toLocaleString('en-IN')} {item.token}</Text>
                  <Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text>
                </View>
                {isExpanded && (
                  <View style={styles.expandedSection}>
                    {item.srcTxHash && <DetailRow label="Source Tx" value={shortHash(item.srcTxHash)} />}
                    {item.dstTxHash && <DetailRow label="Destination Tx" value={shortHash(item.dstTxHash)} />}
                    <DetailRow label="Validator Signatures" value={`${item.validatorSignatures?.length ?? 0} / 2`} />
                    <DetailRow label="Type" value={item.type === 'BURN_UNLOCK' ? 'Bridge Back' : 'Bridge Out'} />
                  </View>
                )}
                <View style={styles.expandHint}>
                  <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textTertiary} />
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: any) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}
function shortHash(h: string) { return `${h.slice(0, 8)}...${h.slice(-6)}`; }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  skeletonWrap: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  listContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.sm },
  card:      { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  cardHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  routeRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardBody:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  amount:    { ...typography.h4, color: colors.text },
  date:      { ...typography.xs, color: colors.textTertiary },
  expandedSection: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { ...typography.xs, color: colors.textTertiary },
  detailValue: { ...typography.xs, color: colors.text, fontWeight: '600' as const, fontSize: 11 },
  expandHint:{ alignItems: 'center', marginTop: 4 },
});
