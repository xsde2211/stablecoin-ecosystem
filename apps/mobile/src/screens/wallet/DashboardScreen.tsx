import React, { useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useDispatch, useSelector } from 'react-redux';
import { fetchBalances, fetchTransactions } from '../../store/slices/walletSlice';
import { AppDispatch, RootState } from '../../store';
import { TokenIcon }  from '../../components/ui/TokenIcon';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { Badge }      from '../../components/ui/Badge';
import { colors, spacing, typography, radius } from '../../theme';

const { width } = Dimensions.get('window');

function ActionButton({ icon, label, onPress }: { icon:string; label:string; onPress:()=>void }) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.75}>
      <LinearGradient
        colors={[colors.surface, colors.bgTertiary]}
        style={styles.actionGradient}
      >
        <Text style={styles.actionIcon}>{icon}</Text>
      </LinearGradient>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function BalanceCard({ item }: { item:any }) {
  const change = (Math.random() * 4 - 2).toFixed(2);
  const isPos  = parseFloat(change) >= 0;
  return (
    <TouchableOpacity style={styles.balanceCard} activeOpacity={0.88}>
      <View style={styles.balanceCardTop}>
        <TokenIcon token={item.symbol} size={40} />
        <View style={{ flex:1, marginLeft:12 }}>
          <Text style={styles.tokenName}>{item.symbol}</Text>
          <ChainBadge chain={item.chain} />
        </View>
        <Badge label={isPos ? `+${change}%` : `${change}%`} variant={isPos ? 'success' : 'error'} />
      </View>
      <View style={styles.balanceCardBottom}>
        <Text style={styles.balanceAmt}>{parseFloat(item.balance).toLocaleString('en-IN', {maximumFractionDigits:4})}</Text>
        <Text style={styles.tokenSymbol}>{item.symbol}</Text>
      </View>
    </TouchableOpacity>
  );
}

function TxRow({ tx }: { tx:any }) {
  const isSend    = tx.type === 'SEND';
  const isBridge  = tx.type?.includes('BRIDGE');
  const icon      = isBridge ? '⇄' : isSend ? '↑' : '↓';
  const iconColor = isBridge ? colors.polygon : isSend ? colors.error : colors.success;
  const amtColor  = isSend ? colors.error : colors.success;
  const amtSign   = isSend ? '-' : '+';
  const timeStr   = tx.createdAt ? new Date(tx.createdAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '';

  return (
    <TouchableOpacity style={styles.txRow} activeOpacity={0.8}>
      <View style={[styles.txIconWrap, { backgroundColor: iconColor+'22' }]}>
        <Text style={[styles.txIcon, { color: iconColor }]}>{icon}</Text>
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txType}>{isBridge?'Bridge Transfer':isSend?'Sent':'Received'}</Text>
        <Text style={styles.txMeta} numberOfLines={1}>
          {tx.txHash ? `${tx.txHash.slice(0,8)}...${tx.txHash.slice(-6)}` : 'Pending'} · {timeStr}
        </Text>
      </View>
      <View style={styles.txRight}>
        <Text style={[styles.txAmt, { color: amtColor }]}>
          {amtSign}{parseFloat(tx.amount??0).toLocaleString('en-IN',{maximumFractionDigits:2})}
        </Text>
        <Text style={styles.txToken}>{tx.tokenSymbol ?? ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function DashboardScreen({ navigation }: any) {
  const dispatch  = useDispatch<AppDispatch>();
  const { balances, transactions, loading } = useSelector((s: RootState) => s.wallet);
  const { user }  = useSelector((s: RootState) => s.auth);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = useCallback(async () => {
    await Promise.all([dispatch(fetchBalances()), dispatch(fetchTransactions())]);
  }, [dispatch]);

  useEffect(() => { load(); }, []);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const totalINR = balances
    .filter(b => b.symbol === 'INRX')
    .reduce((s, b) => s + parseFloat(b.balance ?? 0), 0);

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        {/* Header */}
        <LinearGradient colors={[colors.bgSecondary, colors.bg]} style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.greeting}>Good morning</Text>
              <Text style={styles.userName}>{user?.email?.split('@')[0] ?? 'User'}</Text>
            </View>
            <TouchableOpacity style={styles.avatar} onPress={() => navigation.navigate('Profile')}>
              <Text style={styles.avatarText}>{(user?.email?.[0] ?? 'U').toUpperCase()}</Text>
            </TouchableOpacity>
          </View>

          {/* Portfolio value */}
          <View style={styles.portfolioCard}>
            <LinearGradient
              colors={[colors.teal+'22', colors.teal+'08']}
              style={styles.portfolioGradient}
              start={{ x:0, y:0 }} end={{ x:1, y:1 }}
            >
              <Text style={styles.portfolioLabel}>Total Portfolio</Text>
              <Text style={styles.portfolioValue}>
                ₹{totalINR.toLocaleString('en-IN', { maximumFractionDigits:2 })}
              </Text>
              <View style={styles.portfolioMeta}>
                <Badge label="+2.4% this week" variant="teal" />
                <Text style={styles.portfolioUSD}>
                  ≈ ${(totalINR / 84).toFixed(0)} USD
                </Text>
              </View>
              {/* Subtle reserve badge */}
              <View style={styles.reserveBadge}>
                <View style={styles.reserveDot} />
                <Text style={styles.reserveText}>102% collateralized</Text>
              </View>
            </LinearGradient>
          </View>
        </LinearGradient>

        {/* Actions */}
        <View style={styles.actionsRow}>
          <ActionButton icon="↑"  label="Send"    onPress={() => navigation.navigate('Send')}    />
          <ActionButton icon="↓"  label="Receive" onPress={() => navigation.navigate('Receive')} />
          <ActionButton icon="⇄"  label="Bridge"  onPress={() => navigation.navigate('Bridge')}  />
          <ActionButton icon="⊙"  label="Scan"    onPress={() => navigation.navigate('Scan')}    />
        </View>

        {/* Token balances */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Token Balances</Text>
            <TouchableOpacity><Text style={styles.sectionLink}>All chains →</Text></TouchableOpacity>
          </View>
          {balances.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>◎</Text>
              <Text style={styles.emptyTitle}>No balances yet</Text>
              <Text style={styles.emptyText}>Create or import a wallet to get started</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('CreateWallet')}>
                <Text style={styles.emptyBtnText}>Create Wallet</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.balancesList}>
              {balances.slice(0,6).map((b, i) => <BalanceCard key={i} item={b} />)}
            </View>
          )}
        </View>

        {/* Recent transactions */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Transactions')}>
              <Text style={styles.sectionLink}>View all →</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.txList}>
            {transactions.length === 0 ? (
              <View style={styles.emptyTx}>
                <Text style={styles.emptyTxText}>No transactions yet</Text>
              </View>
            ) : (
              transactions.slice(0,8).map((tx, i) => <TxRow key={i} tx={tx} />)
            )}
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex:1, backgroundColor:colors.bg },
  header:          { paddingHorizontal:spacing.lg, paddingTop:60, paddingBottom:spacing.lg },
  headerRow:       { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:spacing.xl },
  greeting:        { ...typography.sm, color:colors.textSecondary },
  userName:        { ...typography.h3, color:colors.text, textTransform:'capitalize' },
  avatar:          { width:42, height:42, borderRadius:21, backgroundColor:colors.tealBg,
                     borderWidth:1.5, borderColor:colors.teal, alignItems:'center', justifyContent:'center' },
  avatarText:      { color:colors.teal, fontSize:16, fontWeight:'700' },
  portfolioCard:   { borderRadius:radius.xxl, overflow:'hidden', borderWidth:1, borderColor:colors.tealBorder },
  portfolioGradient:{ padding:spacing.xl },
  portfolioLabel:  { ...typography.xs, color:colors.teal, letterSpacing:1, textTransform:'uppercase', marginBottom:8 },
  portfolioValue:  { fontSize:38, fontWeight:'300', color:colors.text, letterSpacing:-1.5, marginBottom:12, fontFamily:'monospace' },
  portfolioMeta:   { flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  portfolioUSD:    { ...typography.sm, color:colors.textSecondary },
  reserveBadge:    { flexDirection:'row', alignItems:'center', marginTop:12, gap:6 },
  reserveDot:      { width:6, height:6, borderRadius:3, backgroundColor:colors.success },
  reserveText:     { ...typography.xs, color:colors.textSecondary },
  actionsRow:      { flexDirection:'row', paddingHorizontal:spacing.lg, paddingVertical:spacing.lg,
                     gap:spacing.sm, justifyContent:'space-between' },
  actionBtn:       { flex:1, alignItems:'center', gap:6 },
  actionGradient:  { width:56, height:56, borderRadius:radius.lg, alignItems:'center', justifyContent:'center',
                     borderWidth:1, borderColor:colors.border },
  actionIcon:      { fontSize:22, color:colors.text },
  actionLabel:     { ...typography.xs, color:colors.textSecondary, fontWeight:'600' },
  section:         { paddingHorizontal:spacing.lg, marginBottom:spacing.xl },
  sectionHeader:   { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:spacing.md },
  sectionTitle:    { ...typography.h4, color:colors.text },
  sectionLink:     { ...typography.sm, color:colors.teal },
  balancesList:    { gap:spacing.sm },
  balanceCard:     { backgroundColor:colors.surface, borderRadius:radius.xl,
                     borderWidth:1, borderColor:colors.border, padding:spacing.lg },
  balanceCardTop:  { flexDirection:'row', alignItems:'center', marginBottom:spacing.md },
  tokenName:       { ...typography.sm, color:colors.text, fontWeight:'700', marginBottom:4 },
  balanceCardBottom:{ flexDirection:'row', alignItems:'baseline', gap:6 },
  balanceAmt:      { fontSize:22, fontWeight:'600', color:colors.text, fontFamily:'monospace' },
  tokenSymbol:     { ...typography.sm, color:colors.textSecondary },
  txList:          { backgroundColor:colors.surface, borderRadius:radius.xl, borderWidth:1, borderColor:colors.border, overflow:'hidden' },
  txRow:           { flexDirection:'row', alignItems:'center', padding:spacing.lg,
                     borderBottomWidth:1, borderBottomColor:colors.border+'66' },
  txIconWrap:      { width:38, height:38, borderRadius:19, alignItems:'center', justifyContent:'center', marginRight:12 },
  txIcon:          { fontSize:16, fontWeight:'700' },
  txInfo:          { flex:1 },
  txType:          { ...typography.body, color:colors.text, fontWeight:'500', marginBottom:2 },
  txMeta:          { ...typography.xs, color:colors.textTertiary, fontFamily:'monospace' },
  txRight:         { alignItems:'flex-end' },
  txAmt:           { ...typography.body, fontWeight:'700', fontFamily:'monospace' },
  txToken:         { ...typography.xs, color:colors.textTertiary, marginTop:2 },
  emptyCard:       { backgroundColor:colors.surface, borderRadius:radius.xl, borderWidth:1,
                     borderColor:colors.border, padding:spacing.xxxl, alignItems:'center' },
  emptyIcon:       { fontSize:36, marginBottom:12, color:colors.textTertiary },
  emptyTitle:      { ...typography.h4, color:colors.text, marginBottom:6 },
  emptyText:       { ...typography.sm, color:colors.textSecondary, textAlign:'center', marginBottom:spacing.lg },
  emptyBtn:        { backgroundColor:colors.tealBg, borderRadius:radius.lg, paddingHorizontal:24, paddingVertical:12,
                     borderWidth:1, borderColor:colors.teal },
  emptyBtnText:    { ...typography.sm, color:colors.teal, fontWeight:'700' },
  emptyTx:         { padding:spacing.xl, alignItems:'center' },
  emptyTxText:     { ...typography.sm, color:colors.textTertiary },
});
