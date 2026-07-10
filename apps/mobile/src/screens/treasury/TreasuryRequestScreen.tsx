import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Header }   from '../../components/ui/Header';
import { Button }   from '../../components/ui/Button';
import { Card }     from '../../components/ui/Card';
import { Badge }    from '../../components/ui/Badge';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

const TOKENS = ['INRX', 'EGOLD', 'ESLVR'];
const CHAINS = ['ethereum', 'bsc', 'polygon'];
const TAB_H  = Platform.OS === 'ios' ? 84 : 68;

const STATUS_VARIANT: Record<string, any> = {
  PENDING_REVIEW: 'warning', PROPOSED: 'info', REJECTED: 'error',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: 'Awaiting review', PROPOSED: 'Approved — on-chain', REJECTED: 'Rejected',
};

export default function TreasuryRequestScreen() {
  const insets   = useSafeAreaInsets();
  const footerPb = insets.bottom > 0 ? insets.bottom + 8 : TAB_H + 8;

  const [opType, setOpType] = useState<'MINT' | 'BURN'>('MINT');
  const [token, setToken]   = useState('INRX');
  const [chain, setChain]   = useState('ethereum');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.getMyTreasuryRequests();
      setRequests(Array.isArray(res) ? res : []);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const canSubmit = amount.trim() && parseFloat(amount) > 0 && reason.trim().length >= 5;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.createTreasuryRequest({ chain, token, opType, amount: amount.trim(), reason: reason.trim() });
      setAmount(''); setReason('');
      Alert.alert(
        'Request submitted ✓',
        'A treasury signer will review this. You\'ll see the status update below once reviewed.'
      );
      load();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Could not submit request.');
    } finally { setSubmitting(false); }
  };

  return (
    <SafeAreaView style={styles.flex} edges={[]}>
      <Header title="Request Mint / Burn" subtitle="Submit a request for treasury review" />
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <View style={styles.modeTabs}>
            <TouchableOpacity
              style={[styles.modeTab, opType === 'MINT' && styles.modeTabActive]}
              onPress={() => setOpType('MINT')} activeOpacity={0.7}
            >
              <Text style={[styles.modeTabText, opType === 'MINT' && { color: colors.teal }]}>Mint</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeTab, opType === 'BURN' && styles.modeTabActive]}
              onPress={() => setOpType('BURN')} activeOpacity={0.7}
            >
              <Text style={[styles.modeTabText, opType === 'BURN' && { color: colors.teal }]}>Burn</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Token</Text>
          <View style={styles.tokenRow}>
            {TOKENS.map(t => (
              <TouchableOpacity key={t} style={[styles.tokenChip, token === t && styles.tokenChipActive]} onPress={() => setToken(t)} activeOpacity={0.7}>
                <TokenIcon token={t} size={24} />
                <Text style={[styles.tokenChipText, token === t && { color: colors.text }]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Network</Text>
          <View style={styles.chainRow}>
            {CHAINS.map(c => (
              <TouchableOpacity key={c} style={[styles.chainChip, chain === c && styles.chainChipActive]} onPress={() => setChain(c)} activeOpacity={0.7}>
                <Text style={[styles.chainChipText, chain === c && { color: colors.teal }]}>{c.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountBox}>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.amountSuffix}>{token}</Text>
          </View>

          <Text style={styles.label}>Reason (required — reviewed by a treasury signer)</Text>
          <View style={styles.reasonBox}>
            <TextInput
              style={styles.reasonInput}
              value={reason}
              onChangeText={setReason}
              placeholder={opType === 'MINT' ? 'e.g. Deposited ₹5,000 via bank transfer for INRX top-up' : 'e.g. Redeeming INRX back to bank'}
              placeholderTextColor={colors.textTertiary}
              multiline
            />
          </View>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={15} color={colors.info} />
            <Text style={styles.infoText}>
              Submitting doesn't mint or burn anything yet — a treasury signer reviews your request first, then it goes through the normal 2-of-3 signature + 12 hour timelock process.
            </Text>
          </View>

          <View style={{ height: spacing.md }} />
          <Button
            label={submitting ? 'Submitting…' : `Submit ${opType.toLowerCase()} request`}
            onPress={handleSubmit}
            loading={submitting}
            disabled={!canSubmit}
          />

          <Text style={styles.sectionTitle}>Your requests</Text>
          {loading ? (
            <Skeleton width="100%" height={72} style={{ marginBottom: spacing.sm }} />
          ) : requests.length === 0 ? (
            <Text style={styles.emptyText}>No requests yet.</Text>
          ) : (
            requests.map((r) => (
              <Card key={r.id} style={{ marginBottom: spacing.sm }}>
                <View style={styles.reqHeader}>
                  <Text style={styles.reqTitle}>{r.opType} {r.amount} {r.token}</Text>
                  <Badge label={STATUS_LABEL[r.status] ?? r.status} variant={STATUS_VARIANT[r.status] ?? 'default'} />
                </View>
                <Text style={styles.reqReason}>{r.reason}</Text>
                {r.rejectedReason && (
                  <Text style={styles.reqRejected}>Rejected: {r.rejectedReason}</Text>
                )}
                <Text style={styles.reqDate}>{new Date(r.createdAt).toLocaleString()}</Text>
              </Card>
            ))
          )}

          <View style={{ height: footerPb + 40 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },

  modeTabs: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 4, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  modeTab:  { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radius.md },
  modeTabActive: { backgroundColor: colors.tealBg2 },
  modeTabText: { ...typography.sm, color: colors.textSecondary, fontWeight: '700' as const },

  label: { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const, marginBottom: spacing.sm, marginTop: spacing.md },
  tokenRow: { flexDirection: 'row', gap: spacing.sm },
  tokenChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  tokenChipActive: { borderColor: colors.teal, backgroundColor: colors.tealBg },
  tokenChipText:   { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },

  chainRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chainChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  chainChipActive: { borderColor: colors.teal, backgroundColor: colors.tealBg },
  chainChipText: { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },

  amountBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.md, height: 56 },
  amountInput: { flex: 1, ...typography.h4, color: colors.text, fontWeight: '700' as const, paddingVertical: 0 },
  amountSuffix: { ...typography.sm, color: colors.textTertiary },

  reasonBox: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, padding: spacing.md, minHeight: 80 },
  reasonInput: { ...typography.sm, color: colors.text, textAlignVertical: 'top' as const },

  infoBox: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.infoBg, padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.lg, alignItems: 'flex-start' },
  infoText: { ...typography.xs, color: colors.info, flex: 1, lineHeight: 18 },

  sectionTitle: { ...typography.h5, color: colors.text, marginTop: spacing.xxl, marginBottom: spacing.md },
  emptyText: { ...typography.sm, color: colors.textTertiary },

  reqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  reqTitle:  { ...typography.sm, color: colors.text, fontWeight: '700' as const },
  reqReason: { ...typography.xs, color: colors.textSecondary, marginBottom: 6 },
  reqRejected: { ...typography.xs, color: colors.error, marginBottom: 6 },
  reqDate:   { ...typography.xs, color: colors.textTertiary },
});