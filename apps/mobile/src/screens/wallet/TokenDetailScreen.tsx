import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/ui/Header';
import { Card }   from '../../components/ui/Card';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import type { RootState } from '../../store';

const TOKEN_META: Record<string, { name:string; desc:string; color:string }> = {
  INRX:  { name:'e-Rupee',  desc:'1 INRX = 1 Indian Rupee, backed by bank deposits & government securities', color:colors.teal   },
  EGOLD: { name:'e-Gold',   desc:'1 eGold = 1 gram of physical gold, fully vaulted',                            color:colors.gold   },
  ESLVR: { name:'e-Silver', desc:'1 eSilver = 1 gram of physical silver, fully vaulted',                        color:colors.silver },
};

export default function TokenDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const token = route.params?.token ?? 'INRX';
  const { balances, transactions } = useSelector((s: RootState) => s.wallet);

  const [reserveInfo, setReserveInfo] = useState<any>(null);
  const [oraclePrice, setOraclePrice] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const meta = TOKEN_META[token];
  const chainBalances = (balances ?? []).filter((b:any) => b.symbol === token);
  const total = chainBalances.reduce((s:number,b:any)=>s+parseFloat(b.balance||'0'),0);
  const tokenTxs = (transactions ?? []).filter((t:any)=>t.tokenSymbol===token);

  useEffect(() => {
    const primaryChain = chainBalances[0]?.chain ?? 'ethereum';
    Promise.allSettled([
      api.getProofOfReserve(token, primaryChain),
      token !== 'INRX' ? api.getOraclePrice(token) : Promise.resolve(null),
    ]).then(([reserve, price]) => {
      if (reserve.status === 'fulfilled') setReserveInfo(reserve.value);
      if (price.status === 'fulfilled') setOraclePrice(price.value);
    }).finally(() => setLoading(false));
  }, [token]);

  return (
    <SafeAreaView style={styles.container}>
      <Header title={meta.name} />
      <ScrollView contentContainerStyle={styles.content}>

        {/* Hero */}
        <View style={styles.hero}>
          <TokenIcon token={token} size={64} />
          <Text style={styles.heroAmount}>{total.toLocaleString('en-IN', { maximumFractionDigits:4 })}</Text>
          <Text style={styles.heroSymbol}>{token}</Text>
          {oraclePrice?.[0]?.price && (
            <Badge label={`₹${oraclePrice[0].price} / gram`} variant="teal" />
          )}
        </View>

        <Text style={styles.description}>{meta.desc}</Text>

        {/* Actions */}
        <View style={styles.actions}>
          <ActionBtn icon="arrow-up" label="Send" onPress={() => navigation.navigate('Send', { token })} />
          <ActionBtn icon="arrow-down" label="Receive" onPress={() => navigation.navigate('Receive', { token })} />
          <ActionBtn icon="swap-horizontal" label="Bridge" onPress={() => navigation.navigate('Bridge', { token })} />
        </View>

        {/* Balances by chain */}
        <Text style={styles.sectionTitle}>Balance by Network</Text>
        <Card>
          {chainBalances.length === 0 ? (
            <Text style={{ ...typography.sm, color:colors.textTertiary, textAlign:'center', paddingVertical:16 }}>No balances yet</Text>
          ) : chainBalances.map((b:any, i:number) => (
            <View key={b.chain} style={[styles.chainRow, i < chainBalances.length-1 && styles.rowBorder]}>
              <ChainBadge chain={b.chain} />
              <Text style={styles.chainBalance}>{parseFloat(b.balance).toLocaleString('en-IN',{maximumFractionDigits:4})} {token}</Text>
            </View>
          ))}
        </Card>

        {/* Reserve info */}
        {loading ? (
          <Skeleton width="100%" height={100} style={{ marginTop:spacing.lg }} />
        ) : reserveInfo && (
          <>
            <Text style={styles.sectionTitle}>Proof of Reserve</Text>
            <Card>
              <Row label="Total Reserve" value={`${parseFloat(reserveInfo.totalReserve||'0').toLocaleString('en-IN')} ${token}`} />
              <Row label="Circulating Supply" value={`${parseFloat(reserveInfo.circulatingSupply||'0').toLocaleString('en-IN')} ${token}`} />
              <Row label="Backing Ratio" value={reserveInfo.backingRatioPct ?? '—'} valueColor={reserveInfo.isFullyBacked?colors.success:colors.warning} />
              <Row label="Status" value={reserveInfo.isFullyBacked ? 'Fully Backed ✓' : 'Under-collateralized'}
                   valueColor={reserveInfo.isFullyBacked?colors.success:colors.warning} last />
            </Card>
          </>
        )}

        {/* Recent transactions */}
        <Text style={styles.sectionTitle}>Recent {token} Activity</Text>
        {tokenTxs.length === 0 ? (
          <Card style={{ alignItems:'center', paddingVertical:24 }}>
            <Text style={{ ...typography.sm, color:colors.textTertiary }}>No transactions for {token}</Text>
          </Card>
        ) : tokenTxs.slice(0,10).map((tx:any) => (
          <TouchableOpacity key={tx.id} style={styles.txRow} onPress={() => navigation.navigate('TransactionDetail', { id: tx.id })}>
            <View style={[styles.txIcon, { backgroundColor: tx.type==='SEND'?colors.errorBg:colors.successBg }]}>
              <Ionicons name={tx.type==='SEND'?'arrow-up':'arrow-down'} size={14} color={tx.type==='SEND'?colors.error:colors.success} />
            </View>
            <View style={{ flex:1 }}>
              <Text style={styles.txTitle}>{tx.type==='SEND'?'Sent':'Received'}</Text>
              <Text style={styles.txSubtitle}>{new Date(tx.createdAt).toLocaleDateString()}</Text>
            </View>
            <Text style={[styles.txAmount, { color: tx.type==='SEND'?colors.error:colors.success }]}>
              {tx.type==='SEND'?'-':'+'}{parseFloat(tx.amount).toFixed(2)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionBtn({ icon, label, onPress }: any) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress}>
      <View style={styles.actionIcon}><Ionicons name={icon} size={20} color={colors.teal} /></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}
function Row({ label, value, valueColor, last }: any) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor && { color:valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor: colors.bg },
  content:   { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  hero:      { alignItems:'center', gap:spacing.sm, paddingVertical:spacing.lg },
  heroAmount:{ ...typography.h1, marginTop:spacing.sm },
  heroSymbol:{ ...typography.sm, color:colors.textSecondary, marginBottom:4 },
  description: { ...typography.sm, color:colors.textSecondary, textAlign:'center', lineHeight:20, marginBottom:spacing.xl },
  actions:   { flexDirection:'row', gap:spacing.sm, marginBottom:spacing.xl },
  actionBtn: { flex:1, alignItems:'center', gap:6 },
  actionIcon:{ width:48, height:48, borderRadius:24, backgroundColor:colors.tealBg2,
               borderWidth:1, borderColor:colors.tealBorder, alignItems:'center', justifyContent:'center' },
  actionLabel: { ...typography.xs, color:colors.textSecondary, fontWeight:'600' },
  sectionTitle: { ...typography.h4, marginBottom:spacing.md, marginTop:spacing.lg },
  chainRow:  { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:spacing.sm },
  chainBalance: { ...typography.sm, color:colors.text, fontWeight:'700' },
  row:       { flexDirection:'row', justifyContent:'space-between', paddingVertical:spacing.sm },
  rowBorder: { borderBottomWidth:1, borderBottomColor: colors.border },
  rowLabel:  { ...typography.sm, color:colors.textSecondary },
  rowValue:  { ...typography.sm, color:colors.text, fontWeight:'600' },
  txRow:     { flexDirection:'row', alignItems:'center', gap:spacing.md, paddingVertical:spacing.sm },
  txIcon:    { width:32, height:32, borderRadius:16, alignItems:'center', justifyContent:'center' },
  txTitle:   { ...typography.sm, color:colors.text, fontWeight:'600' },
  txSubtitle:{ ...typography.xs, color:colors.textTertiary, marginTop:2 },
  txAmount:  { ...typography.sm, fontWeight:'700' },
});
