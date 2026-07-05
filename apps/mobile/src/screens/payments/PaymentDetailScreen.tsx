import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { Header } from '../../components/ui/Header';
import { Card }   from '../../components/ui/Card';
import { Badge }  from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { Skeleton }  from '../../components/ui/Skeleton';
import { colors, typography, spacing } from '../../theme';
import { api } from '../../services/api';

const FOOTER_EXTRA = Platform.OS === 'ios' ? 16 : 8;
const STATUS_VARIANT: Record<string, any> = { PENDING: 'warning', PAID: 'success', EXPIRED: 'error', CANCELLED: 'error', REFUNDED: 'info' };

export default function PaymentDetailScreen() {
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const footerPb = insets.bottom + FOOTER_EXTRA;
  const { id } = route.params;
  const [payment, setPayment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    api.getPayment(id).then(setPayment).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await api.cancelPayment(id);
      setPayment((p: any) => ({ ...p, status: 'CANCELLED' }));
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to cancel');
    } finally { setCancelling(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header title="Payment" />
        <View style={styles.skeletonWrap}>
          <Skeleton width="100%" height={140} />
          <Skeleton width="100%" height={160} />
        </View>
      </SafeAreaView>
    );
  }

  if (!payment) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title="Payment Details" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: footerPb + 40 }]} showsVerticalScrollIndicator={false}>
        <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
          <TokenIcon token={payment.token} size={56} />
          <Text style={[typography.h1, { marginTop: 16 }]}>{parseFloat(payment.amount).toLocaleString('en-IN')} {payment.token}</Text>
          {payment.description && <Text style={{ ...typography.sm, color: colors.textSecondary, marginTop: 8 }}>{payment.description}</Text>}
          <View style={{ marginTop: 12 }}><Badge label={payment.status} variant={STATUS_VARIANT[payment.status] ?? 'default'} /></View>
        </Card>

        <Card style={{ marginTop: spacing.lg }}>
          <Row label="Reference" value={payment.reference ?? '—'} />
          <Row label="Created" value={new Date(payment.createdAt).toLocaleString()} />
          <Row label="Expires" value={new Date(payment.expiresAt).toLocaleString()} />
          {payment.paidAt && <Row label="Paid at" value={new Date(payment.paidAt).toLocaleString()} />}
          {payment.txHash && <Row label="Tx Hash" value={`${payment.txHash.slice(0, 10)}...`} mono />}
          {payment.paidOnChain && <Row label="Paid on" value={payment.paidOnChain.toUpperCase()} last />}
        </Card>

        {payment.status === 'PENDING' && (
          <View style={{ marginTop: spacing.lg }}>
            <Button label="Cancel Payment Request" variant="danger" onPress={handleCancel} loading={cancelling} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, mono, last }: any) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && typography.mono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  skeletonWrap: { padding: spacing.xl, gap: spacing.md },
  content:   { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  row:       { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel:  { ...typography.sm, color: colors.textSecondary },
  rowValue:  { ...typography.sm, color: colors.text, fontWeight: '600' as const },
});
