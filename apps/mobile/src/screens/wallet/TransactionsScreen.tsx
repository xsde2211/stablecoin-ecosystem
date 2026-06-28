import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  SafeAreaView, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/ui/Header';
import { Badge }  from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

const FILTERS = ['All','Sent','Received','Bridge'];

export default function TransactionsScreen() {
  const navigation = useNavigation<any>();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (pageNum = 1, append = false) => {
    try {
      const res = await api.getTransactions(pageNum, 20);
      const data = res.data ?? res.transactions ?? [];
      setTransactions(prev => append ? [...prev, ...data] : data);
      setHasMore(data.length === 20);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(1); }, [load]);

  const onRefresh = () => { setRefreshing(true); setPage(1); load(1); };
  const loadMore  = () => { if (hasMore && !loading) { const next = page+1; setPage(next); load(next, true); } };

  const filtered = transactions.filter(tx => {
    if (filter === 'All') return true;
    if (filter === 'Sent') return tx.type === 'SEND';
    if (filter === 'Received') return tx.type === 'RECEIVE';
    if (filter === 'Bridge') return tx.type?.startsWith('BRIDGE');
    return true;
  });

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Transactions" />

      <View style={styles.filters}>
        {FILTERS.map(f => (
          <TouchableOpacity key={f} style={[styles.filterChip, filter===f && styles.filterChipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterText, filter===f && styles.filterTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={{ paddingHorizontal:spacing.xl, gap:spacing.sm }}>
          {[1,2,3,4,5].map(i => <Skeleton key={i} width="100%" height={68} />)}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={<EmptyState icon="receipt-outline" title="No transactions" subtitle="Your activity will show up here" />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('TransactionDetail', { id: item.id })}>
              <View style={[styles.icon, { backgroundColor: getIconBg(item.type) }]}>
                <Ionicons name={getIcon(item.type)} size={18} color={getIconColor(item.type)} />
              </View>
              <View style={{ flex:1 }}>
                <Text style={styles.title}>{getLabel(item.type)} {item.tokenSymbol}</Text>
                <Text style={styles.subtitle}>{item.chain?.toUpperCase()} · {new Date(item.createdAt).toLocaleDateString()}</Text>
              </View>
              <View style={{ alignItems:'flex-end' }}>
                <Text style={[styles.amount, { color: getIconColor(item.type) }]}>
                  {item.type==='SEND'?'-':'+'}{parseFloat(item.amount).toFixed(2)}
                </Text>
                <Badge label={item.status} variant={item.status==='CONFIRMED'?'success':item.status==='PENDING'?'warning':'error'} />
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function getIcon(type:string) {
  if (type === 'SEND') return 'arrow-up';
  if (type === 'RECEIVE') return 'arrow-down';
  if (type?.startsWith('BRIDGE')) return 'swap-horizontal';
  if (type === 'MINT') return 'add-circle-outline';
  if (type === 'BURN') return 'flame-outline';
  return 'sync';
}
function getIconColor(type:string) {
  if (type === 'SEND') return colors.error;
  if (type === 'RECEIVE') return colors.success;
  return colors.teal;
}
function getIconBg(type:string) {
  if (type === 'SEND') return colors.errorBg;
  if (type === 'RECEIVE') return colors.successBg;
  return colors.tealBg;
}
function getLabel(type:string) {
  const map: Record<string,string> = { SEND:'Sent', RECEIVE:'Received', BRIDGE_LOCK:'Bridge Lock', BRIDGE_MINT:'Bridge Mint', MINT:'Minted', BURN:'Burned', SWAP:'Swapped' };
  return map[type] ?? type;
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor: colors.bg },
  filters:   { flexDirection:'row', gap:spacing.sm, paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  filterChip:{ paddingHorizontal:14, paddingVertical:8, borderRadius:radius.full, backgroundColor:colors.surface, borderWidth:1, borderColor:colors.border },
  filterChipActive: { backgroundColor:colors.tealBg2, borderColor:colors.tealBorder },
  filterText: { ...typography.sm, color:colors.textSecondary, fontWeight:'600' },
  filterTextActive: { color:colors.teal },
  row:       { flexDirection:'row', alignItems:'center', gap:spacing.md, paddingVertical:spacing.sm },
  icon:      { width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  title:     { ...typography.h5, color:colors.text },
  subtitle:  { ...typography.xs, color:colors.textTertiary, marginTop:2 },
  amount:    { ...typography.h5, fontSize:14 },
});
