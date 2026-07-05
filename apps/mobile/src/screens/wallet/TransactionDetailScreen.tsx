import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/ui/Header';
import { Card }   from '../../components/ui/Card';
import { Badge }  from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { TokenIcon }  from '../../components/ui/TokenIcon';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

const EXPLORERS: Record<string, string> = {
  ethereum: 'https://sepolia.etherscan.io/tx/',
  polygon:  'https://amoy.polygonscan.com/tx/',
  bsc:      'https://testnet.bscscan.com/tx/',
  tron:     'https://nile.tronscan.org/#/transaction/',
};

export default function TransactionDetailScreen() {
  const route = useRoute<any>();
  const { id } = route.params;
  const [tx, setTx] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getTransaction(id).then(setTx).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header title="Transaction" />
        <View style={styles.skeletonWrap}>
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={200} />
        </View>
      </SafeAreaView>
    );
  }

  if (!tx) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header title="Transaction" />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.textTertiary} />
          <Text style={styles.notFoundText}>Transaction not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isSend = tx.type === 'SEND';

  const openExplorer = () => {
    const base = EXPLORERS[tx.chain];
    if (base && tx.txHash) Linking.openURL(base + tx.txHash);
  };

  const copyHash = async () => {
    await Clipboard.setStringAsync(tx.txHash);
    Alert.alert('Copied', 'Transaction hash copied');
  };

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <Header title="Transaction Details" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: isSend ? colors.errorBg : colors.successBg }]}>
            <Ionicons name={isSend ? 'arrow-up' : 'arrow-down'} size={28} color={isSend ? colors.error : colors.success} />
          </View>
          <Text style={[styles.heroAmount, { color: isSend ? colors.error : colors.success }]}>
            {isSend ? '-' : '+'}{parseFloat(tx.amount).toLocaleString('en-IN', { maximumFractionDigits: 6 })}
          </Text>
          <View style={styles.heroSymRow}>
            <TokenIcon token={tx.tokenSymbol} size={20} />
            <Text style={styles.heroSymbol}>{tx.tokenSymbol}</Text>
          </View>
          <View style={{ marginTop: 12 }}>
            <Badge label={tx.status} variant={tx.status === 'CONFIRMED' ? 'success' : tx.status === 'PENDING' ? 'warning' : 'error'} />
          </View>
        </View>

        <Card>
          <Row label="Type" value={tx.type} />
          <Row label="Network"><ChainBadge chain={tx.chain} /></Row>
          <Row label="From" value={shortAddr(tx.fromAddress)} mono />
          <Row label="To" value={shortAddr(tx.toAddress)} mono />
          <Row label="Date" value={new Date(tx.createdAt).toLocaleString()} />
          {tx.confirmedAt && <Row label="Confirmed" value={new Date(tx.confirmedAt).toLocaleString()} />}
          {tx.gasUsed && <Row label="Network Fee" value={tx.gasUsed.toString()} />}
          {tx.txHash && <Row label="Tx Hash" value={shortAddr(tx.txHash)} mono last />}
        </Card>

        {tx.txHash && EXPLORERS[tx.chain] && (
          <TouchableOpacity style={styles.explorerBtn} onPress={openExplorer} activeOpacity={0.7}>
            <Ionicons name="open-outline" size={18} color={colors.teal} />
            <Text style={styles.explorerText}>View on Block Explorer</Text>
          </TouchableOpacity>
        )}

        {tx.txHash && (
          <TouchableOpacity style={styles.copyBtn} onPress={copyHash} activeOpacity={0.7}>
            <Ionicons name="copy-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.copyText}>Copy transaction hash</Text>
          </TouchableOpacity>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function shortAddr(s?: string) {
  if (!s) return '—';
  return s.length > 16 ? `${s.slice(0, 8)}...${s.slice(-6)}` : s;
}
function Row({ label, value, mono, last, children }: any) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children ?? <Text style={[styles.rowValue, mono && typography.mono]}>{value}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  skeletonWrap: { padding: spacing.xl, gap: spacing.md },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  notFoundText: { ...typography.sm, color: colors.textTertiary },
  content:   { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl },
  hero:      { alignItems: 'center', paddingVertical: spacing.xl },
  heroIcon:  { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  heroAmount:{ ...typography.h1, fontSize: 32 },
  heroSymRow:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  heroSymbol:{ ...typography.h5, color: colors.textSecondary },
  row:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel:  { ...typography.sm, color: colors.textSecondary },
  rowValue:  { ...typography.sm, color: colors.text, fontWeight: '600' as const },
  explorerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.tealBg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.tealBorder },
  explorerText: { ...typography.sm, color: colors.teal, fontWeight: '700' as const },
  copyBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.md, padding: spacing.sm },
  copyText:  { ...typography.xs, color: colors.textSecondary },
});
