import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useDispatch, useSelector } from 'react-redux';
import { fetchTransactions } from '../../store/slices/walletSlice';
import { AppDispatch, RootState } from '../../store';
import { colors, spacing, typography, radius } from '../../theme';

function TxRow({ tx }: { tx: any }) {
  const isSend   = tx.type === 'SEND';
  const isBridge = tx.type?.includes('BRIDGE');
  const icon     = isBridge ? '⇄' : isSend ? '↑' : '↓';
  const color    = isBridge ? colors.polygon : isSend ? colors.error : colors.success;
  const sign     = isSend ? '-' : '+';
  const date     = tx.createdAt
    ? new Date(tx.createdAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
    : '';

  return (
    <View style={styles.txRow}>
      <View style={[styles.txIcon, { backgroundColor: color + '22' }]}>
        <Text style={{ color, fontSize: 16, fontWeight: '700' }}>{icon}</Text>
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txType}>
          {isBridge ? 'Bridge' : isSend ? 'Sent' : 'Received'}
        </Text>
        <Text style={styles.txHash} numberOfLines={1}>
          {tx.txHash ? `${tx.txHash.slice(0,10)}...${tx.txHash.slice(-6)}` : 'Pending'}
        </Text>
        <Text style={styles.txDate}>{date}</Text>
      </View>
      <View style={styles.txRight}>
        <Text style={[styles.txAmount, { color: isSend ? colors.error : colors.success }]}>
          {sign}{parseFloat(tx.amount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
        </Text>
        <Text style={styles.txToken}>{tx.tokenSymbol}</Text>
        <View style={[styles.txStatus, {
          backgroundColor: tx.status === 'CONFIRMED' ? colors.successBg : colors.warningBg
        }]}>
          <Text style={{ fontSize: 10, fontWeight: '600',
            color: tx.status === 'CONFIRMED' ? colors.success : colors.warning }}>
            {tx.status}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function TransactionsScreen({ navigation }: any) {
  const dispatch     = useDispatch<AppDispatch>();
  const { transactions, loading } = useSelector((s: RootState) => s.wallet);
  const [refreshing, setRefreshing] = React.useState(false);

  useEffect(() => { dispatch(fetchTransactions()); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await dispatch(fetchTransactions());
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.bgSecondary, colors.bg]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Transaction History</Text>
        <View style={{ width: 32 }} />
      </View>

      <FlatList
        data={transactions}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => <TxRow tx={item} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>◎</Text>
            <Text style={styles.emptyText}>No transactions yet</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:colors.bg },
  topBar:    { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
               paddingHorizontal:spacing.lg, paddingTop:60, paddingBottom:spacing.md },
  back:      { fontSize:26, color:colors.text, fontWeight:'300' },
  title:     { ...typography.h4, color:colors.text },
  list:      { paddingHorizontal:spacing.lg, paddingBottom:100 },
  txRow:     { flexDirection:'row', alignItems:'center', paddingVertical:spacing.md,
               borderBottomWidth:1, borderBottomColor:colors.border + '55', gap:12 },
  txIcon:    { width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  txInfo:    { flex:1 },
  txType:    { ...typography.body, color:colors.text, fontWeight:'600', marginBottom:2 },
  txHash:    { ...typography.xs, color:colors.textTertiary, fontFamily:'monospace', marginBottom:2 },
  txDate:    { ...typography.xs, color:colors.textTertiary },
  txRight:   { alignItems:'flex-end', gap:3 },
  txAmount:  { ...typography.body, fontWeight:'700', fontFamily:'monospace' },
  txToken:   { ...typography.xs, color:colors.textTertiary },
  txStatus:  { paddingHorizontal:8, paddingVertical:2, borderRadius:radius.full },
  empty:     { alignItems:'center', paddingTop:80 },
  emptyIcon: { fontSize:40, color:colors.textTertiary, marginBottom:12 },
  emptyText: { ...typography.body, color:colors.textSecondary },
});