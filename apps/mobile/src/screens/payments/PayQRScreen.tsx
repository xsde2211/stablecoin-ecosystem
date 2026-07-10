import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, TextInput, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { Header }    from '../../components/ui/Header';
import { Button }    from '../../components/ui/Button';
import { Card }      from '../../components/ui/Card';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import type { RootState } from '../../store';

const TAB_H = Platform.OS === 'ios' ? 84 : 68;

export default function PayQRScreen() {
  const navigation = useNavigation<any>();
  const insets     = useSafeAreaInsets();
  const footerPb   = insets.bottom > 0 ? insets.bottom + 8 : TAB_H + 8;
  const { activeWalletIndex } = useSelector((s: RootState) => s.wallet);

  const [payment,  setPayment]  = useState<any>(null);
  const [manualId, setManualId] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [paying,   setPaying]   = useState(false);

  const loadPayment = async (paymentId: string) => {
    const id = paymentId.trim();
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.getPayment(id);
      if (res.status !== 'PENDING') {
        Alert.alert('Payment unavailable', `This payment is already ${res.status?.toLowerCase()}.`);
        return;
      }
      setPayment(res);
    } catch {
      Alert.alert(
        'Not found',
        'No payment found with that ID.\n\nNote: This is not a UPI address field — enter the Payment ID from a merchant\'s QR code (a UUID like "a1b2c3d4-...").',
      );
    } finally { setLoading(false); }
  };

  const confirmPay = async () => {
    setPaying(true);
    try {
      await api.sendToken({
        token:     payment.token,
        chain:     payment.settlementChain,
        toAddress: payment.settlementAddress,
        amount:    payment.amount.toString(),
        walletIndex: activeWalletIndex,
      });
      Alert.alert('Payment sent', 'Your payment is being processed.', [
        { text: 'OK', onPress: () => navigation.navigate('DashboardTab') },
      ]);
    } catch (err: any) {
      Alert.alert('Payment failed', err?.response?.data?.message ?? 'Please try again');
    } finally { setPaying(false); }
  };

  // ── Confirm payment screen ────────────────────────────────────────────────
  if (payment) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Header title="Confirm Payment" />
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
              <TokenIcon token={payment.token} size={56} />
              <Text style={[typography.h1, { marginTop: 16 }]}>{payment.amount} {payment.token}</Text>
              {payment.description && (
                <Text style={styles.payDesc}>{payment.description}</Text>
              )}
            </Card>
            <Card style={{ marginTop: spacing.lg }}>
              <Row label="Merchant"  value={payment.merchant?.businessName ?? '—'} />
              <Row label="Network"   value={payment.settlementChain?.toUpperCase()} />
              <Row label="Reference" value={payment.reference ?? '—'} last />
            </Card>
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: footerPb }]}>
            <Button label={`Pay ${payment.amount} ${payment.token}`} onPress={confirmPay} loading={paying} />
            <View style={{ height: spacing.sm }} />
            <Button label="Cancel" variant="ghost" onPress={() => setPayment(null)} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Scan / lookup screen ──────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.flex} edges={[]}>
      <Header title="Scan to Pay" />
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Camera placeholder */}
          <View style={styles.scannerFrame}>
            <Ionicons name="qr-code-outline" size={52} color={colors.textTertiary} />
            <Text style={styles.scannerTitle}>Scan merchant QR code</Text>
            <Text style={styles.scannerHint}>
              Camera scanner coming soon.{'\n'}Use Payment ID lookup below.
            </Text>
          </View>

          {/* Important note about what this field expects */}
          <View style={styles.noteBox}>
            <Ionicons name="information-circle" size={16} color={colors.info} />
            <Text style={styles.noteText}>
              <Text style={{ fontWeight: '700' as const, color: colors.text }}>This is not a UPI payment.</Text>
              {' '}Enter the <Text style={{ color: colors.teal }}>Payment ID</Text> (UUID) from a merchant's INRX payment request.
              UPI IDs (like name@gpay) will not work here.
            </Text>
          </View>

          <Text style={styles.label}>Payment ID</Text>
          <View style={styles.idBox}>
            <TextInput
              style={styles.idInput}
              value={manualId}
              onChangeText={setManualId}
              placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Text style={styles.idHint}>
            Ask the merchant for their Payment ID, or scan their QR code with the camera above.
          </Text>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: footerPb }]}>
          <Button
            label="Look up payment"
            onPress={() => loadPayment(manualId)}
            loading={loading}
            disabled={!manualId.trim()}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, last }: any) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  footer:  { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },

  scannerFrame: {
    aspectRatio: 1, backgroundColor: colors.surface, borderRadius: radius.xxl,
    borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed' as const,
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl,
  },
  scannerTitle: { ...typography.h4, color: colors.text },
  scannerHint:  { ...typography.sm, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },

  noteBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.infoBg, padding: spacing.md, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.info + '30', marginTop: spacing.lg,
  },
  noteText: { ...typography.sm, color: colors.textSecondary, flex: 1, lineHeight: 20 },

  label: { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const, marginTop: spacing.lg, marginBottom: spacing.sm },
  idBox: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 56, justifyContent: 'center',
  },
  idInput: { ...typography.body, color: colors.text },
  idHint:  { ...typography.xs, color: colors.textTertiary, marginTop: spacing.sm, lineHeight: 16 },

  payDesc: { ...typography.sm, color: colors.textSecondary, marginTop: 8, textAlign: 'center' },

  row:       { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel:  { ...typography.sm, color: colors.textSecondary },
  rowValue:  { ...typography.sm, color: colors.text, fontWeight: '600' as const },
});