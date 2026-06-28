import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/ui/Header';
import { Button } from '../../components/ui/Button';
import { Card }   from '../../components/ui/Card';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

/**
 * Scan-to-pay screen.
 * In production, integrate `expo-camera`'s CameraView with onBarcodeScanned.
 * Here we provide the full flow scaffold + manual payment-ID entry fallback,
 * since camera permission/native module setup is environment-specific.
 */
export default function PayQRScreen() {
  const navigation = useNavigation<any>();
  const [scanning, setScanning] = useState(true);
  const [payment, setPayment]   = useState<any>(null);
  const [manualId, setManualId] = useState('');
  const [loading, setLoading]   = useState(false);
  const [paying, setPaying]     = useState(false);

  const loadPayment = async (paymentId: string) => {
    setLoading(true);
    try {
      const res = await api.getPayment(paymentId);
      if (res.status !== 'PENDING') {
        Alert.alert('Payment unavailable', `This payment is ${res.status?.toLowerCase()}.`);
        return;
      }
      setPayment(res);
      setScanning(false);
    } catch {
      Alert.alert('Not found', 'Invalid or expired payment QR code');
    } finally {
      setLoading(false);
    }
  };

  const handleScan = (data: string) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.paymentId) loadPayment(parsed.paymentId);
    } catch {
      // Maybe it's a deep link: stablecoin://pay?id=xxx
      const match = data.match(/id=([\w-]+)/);
      if (match) loadPayment(match[1]);
    }
  };

  const confirmPay = async () => {
    setPaying(true);
    try {
      await api.sendToken({
        token: payment.token,
        chain: payment.settlementChain,
        toAddress: payment.settlementAddress,
        amount: payment.amount.toString(),
      });
      Alert.alert('Payment sent', 'Your payment is being processed.', [
        { text: 'OK', onPress: () => navigation.navigate('Dashboard') },
      ]);
    } catch (err: any) {
      Alert.alert('Payment failed', err?.response?.data?.message || 'Please try again');
    } finally {
      setPaying(false);
    }
  };

  if (payment) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Confirm Payment" />
        <View style={styles.content}>
          <Card style={{ alignItems:'center', paddingVertical:32 }}>
            <TokenIcon token={payment.token} size={56} />
            <Text style={[typography.h1, { marginTop:16 }]}>{payment.amount} {payment.token}</Text>
            {payment.description && (
              <Text style={{ ...typography.sm, color:colors.textSecondary, marginTop:8, textAlign:'center' }}>{payment.description}</Text>
            )}
          </Card>

          <Card style={{ marginTop:spacing.lg }}>
            <Row label="Merchant" value={payment.merchant?.businessName ?? '—'} />
            <Row label="Network" value={payment.settlementChain?.toUpperCase()} />
            <Row label="Reference" value={payment.reference ?? '—'} last />
          </Card>

          <View style={{ flex:1 }} />
          <Button label={`Pay ${payment.amount} ${payment.token}`} onPress={confirmPay} loading={paying} />
          <View style={{ height:spacing.md }} />
          <Button label="Cancel" variant="ghost" onPress={() => { setPayment(null); setScanning(true); }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Scan to Pay" />
      <View style={styles.content}>
        <View style={styles.scannerFrame}>
          <Ionicons name="qr-code-outline" size={64} color={colors.textTertiary} />
          <Text style={{ ...typography.sm, color:colors.textTertiary, marginTop:12, textAlign:'center' }}>
            Camera scanner goes here.{'\n'}Add expo-camera CameraView with{'\n'}onBarcodeScanned={'{handleScan}'}
          </Text>
        </View>

        <Text style={styles.orText}>or enter payment ID manually</Text>

        <View style={styles.manualRow}>
          <View style={styles.manualInput}>
            <Text style={{ ...typography.sm, color: manualId?colors.text:colors.textTertiary }}>
              {manualId || 'Payment ID'}
            </Text>
          </View>
        </View>

        <ManualEntry value={manualId} onChange={setManualId} />

        <Button label="Look up payment" onPress={() => loadPayment(manualId)} loading={loading} disabled={!manualId} />
      </View>
    </SafeAreaView>
  );
}

function ManualEntry({ value, onChange }: { value:string; onChange:(v:string)=>void }) {
  const { TextInput } = require('react-native');
  return (
    <TextInput
      style={styles.textInput}
      value={value}
      onChangeText={onChange}
      placeholder="Paste payment ID"
      placeholderTextColor={colors.textTertiary}
      autoCapitalize="none"
    />
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
  container: { flex:1, backgroundColor: colors.bg },
  content:   { flex:1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  scannerFrame: { aspectRatio:1, backgroundColor:colors.surface, borderRadius:radius.xxl,
                  borderWidth:2, borderColor:colors.border, borderStyle:'dashed',
                  alignItems:'center', justifyContent:'center', padding:spacing.xl, marginTop:spacing.lg },
  orText:    { ...typography.sm, color:colors.textTertiary, textAlign:'center', marginVertical:spacing.lg },
  manualRow: { marginBottom:spacing.md },
  manualInput: {},
  textInput: { backgroundColor:colors.surface, borderRadius:radius.lg, borderWidth:1, borderColor:colors.border,
               padding:spacing.md, color:colors.text, ...typography.body, marginBottom:spacing.lg },
  row:       { flexDirection:'row', justifyContent:'space-between', paddingVertical:spacing.sm },
  rowBorder: { borderBottomWidth:1, borderBottomColor: colors.border },
  rowLabel:  { ...typography.sm, color:colors.textSecondary },
  rowValue:  { ...typography.sm, color:colors.text, fontWeight:'600' },
});
