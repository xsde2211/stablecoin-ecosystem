import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, Alert, TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/ui/Header';
import { Input }  from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card }   from '../../components/ui/Card';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

const TOKENS = ['INRX','EGOLD','ESLVR'];
const EXPIRY_OPTIONS = [
  { label:'5 min',  value:300 },
  { label:'15 min', value:900 },
  { label:'1 hour', value:3600 },
  { label:'24 hours', value:86400 },
];

export default function CreatePaymentScreen() {
  const navigation = useNavigation<any>();
  const [amount, setAmount]     = useState('');
  const [token, setToken]       = useState('INRX');
  const [description, setDescription] = useState('');
  const [reference, setReference]     = useState('');
  const [expiresIn, setExpiresIn]     = useState(900);
  const [loading, setLoading]   = useState(false);
  const [payment, setPayment]   = useState<any>(null);

  const handleCreate = async () => {
    if (!amount || parseFloat(amount) <= 0) { Alert.alert('Invalid amount', 'Enter an amount greater than 0'); return; }
    setLoading(true);
    try {
      const res = await api.createPayment({ amount, token, description: description||undefined, reference: reference||undefined, expiresIn });
      setPayment(res);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to create payment';
      if (msg.includes('not registered as a merchant')) {
        Alert.alert('Merchant account required', 'You need to register as a merchant to create payment requests.', [
          { text:'Register', onPress: () => navigation.navigate('MerchantRegister') },
          { text:'Cancel', style:'cancel' },
        ]);
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  if (payment) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Payment Request" />
        <ScrollView contentContainerStyle={styles.content}>
          <Card style={{ alignItems:'center', paddingVertical:32 }}>
            <TokenIcon token={token} size={56} />
            <Text style={[typography.h1, { marginTop:16 }]}>{amount} {token}</Text>
            {description && <Text style={{ ...typography.sm, color:colors.textSecondary, marginTop:8 }}>{description}</Text>}
          </Card>

          {payment.qrData && (
            <Card style={{ alignItems:'center', marginTop:spacing.lg, paddingVertical:spacing.xl }}>
              <View style={styles.qrWrap}>
                {/* qrData is a data:image/png;base64 URL returned by payment-service */}
                <QRImage src={payment.qrData} />
              </View>
              <Text style={{ ...typography.xs, color:colors.textTertiary, marginTop:spacing.md }}>
                Share this QR with the customer to scan & pay
              </Text>
            </Card>
          )}

          <Card style={{ marginTop:spacing.lg }}>
            <Row label="Payment ID" value={payment.id?.slice(0,8)+'...'} mono />
            <Row label="Expires" value={new Date(payment.expiresAt).toLocaleString()} />
            <Row label="Status" value="Pending" valueColor={colors.warning} last />
          </Card>

          <View style={{ height:spacing.lg }} />
          <Button label="Create Another" variant="secondary" onPress={() => setPayment(null)} />
          <View style={{ height:spacing.md }} />
          <Button label="Done" onPress={() => navigation.goBack()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Request Payment" subtitle="Generate a QR code for customers" />
      <ScrollView contentContainerStyle={styles.content}>

        <Text style={styles.label}>Asset</Text>
        <View style={styles.tokenSelector}>
          {TOKENS.map(t => (
            <TouchableOpacity key={t} style={[styles.tokenChip, token===t && styles.tokenChipActive]} onPress={() => setToken(t)}>
              <TokenIcon token={t} size={28} />
              <Text style={[styles.tokenChipText, token===t && { color:colors.text }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Amount</Text>
        <View style={styles.amountInputWrap}>
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

        <Input label="Description (optional)" placeholder="e.g. Coffee & snacks" value={description} onChangeText={setDescription} />
        <Input label="Order reference (optional)" placeholder="e.g. ORDER-1234" value={reference} onChangeText={setReference} />

        <Text style={styles.label}>Expires in</Text>
        <View style={styles.expirySelector}>
          {EXPIRY_OPTIONS.map(opt => (
            <TouchableOpacity key={opt.value} style={[styles.expiryChip, expiresIn===opt.value && styles.expiryChipActive]} onPress={() => setExpiresIn(opt.value)}>
              <Text style={[styles.expiryText, expiresIn===opt.value && { color:colors.teal }]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height:spacing.lg }} />
        <Button label="Generate QR Code" onPress={handleCreate} loading={loading} />
      </ScrollView>
    </SafeAreaView>
  );
}

function QRImage({ src }: { src: string }) {
  const { Image } = require('react-native');
  return <Image source={{ uri: src }} style={{ width:200, height:200 }} resizeMode="contain" />;
}

function Row({ label, value, valueColor, mono, last }: any) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && typography.mono, valueColor && { color:valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor: colors.bg },
  content:   { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  label:     { ...typography.sm, color:colors.textSecondary, fontWeight:'600', marginBottom:10, marginTop: spacing.lg },
  tokenSelector: { flexDirection:'row', gap:spacing.sm },
  tokenChip:  { flex:1, alignItems:'center', gap:6, padding:spacing.md, borderRadius:radius.lg,
                backgroundColor:colors.surface, borderWidth:1, borderColor:colors.border },
  tokenChipActive: { borderColor: colors.tealBorder, backgroundColor: colors.tealBg },
  tokenChipText: { ...typography.sm, color:colors.textSecondary, fontWeight:'700' },
  amountInputWrap: { flexDirection:'row', alignItems:'center', backgroundColor:colors.surface,
                     borderRadius:radius.lg, borderWidth:1, borderColor:colors.border, paddingHorizontal:spacing.md },
  amountInput: { flex:1, ...typography.h2, fontWeight:'700', color:colors.text, paddingVertical:16 },
  amountSuffix: { ...typography.h5, color:colors.textSecondary },
  expirySelector: { flexDirection:'row', flexWrap:'wrap', gap:spacing.sm },
  expiryChip: { paddingHorizontal:14, paddingVertical:10, borderRadius:radius.md, backgroundColor:colors.surface, borderWidth:1, borderColor:colors.border },
  expiryChipActive: { borderColor:colors.tealBorder, backgroundColor:colors.tealBg },
  expiryText: { ...typography.sm, color:colors.textSecondary, fontWeight:'600' },
  qrWrap:    { padding:spacing.md, backgroundColor:'#fff', borderRadius:radius.lg },
  row:       { flexDirection:'row', justifyContent:'space-between', paddingVertical:spacing.sm },
  rowBorder: { borderBottomWidth:1, borderBottomColor: colors.border },
  rowLabel:  { ...typography.sm, color:colors.textSecondary },
  rowValue:  { ...typography.sm, color:colors.text, fontWeight:'600' },
});
