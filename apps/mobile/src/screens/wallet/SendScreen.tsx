import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/ui/Header';
import { Input }  from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card }   from '../../components/ui/Card';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import type { RootState } from '../../store';

const TOKENS = ['INRX','EGOLD','ESLVR'];
const CHAINS = ['tron','ethereum','bsc','polygon'];

export default function SendScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { balances } = useSelector((s: RootState) => s.wallet);

  const [token, setToken] = useState(route.params?.token ?? 'INRX');
  const [chain, setChain] = useState(route.params?.chain ?? 'tron');
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount]       = useState('');
  const [loading, setLoading]     = useState(false);
  const [step, setStep]           = useState<'form'|'review'|'success'>('form');
  const [txResult, setTxResult]   = useState<any>(null);

  const balance = (balances ?? []).find((b:any) => b.symbol === token && b.chain === chain);
  const availableBalance = parseFloat(balance?.balance ?? '0');

  const handleSend = async () => {
    setLoading(true);
    try {
      const res = await api.sendToken({ token, chain, toAddress, amount });
      setTxResult(res);
      setStep('success');
    } catch (err: any) {
      Alert.alert('Transaction failed', err?.response?.data?.message || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'success') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={40} color={colors.success} />
          </View>
          <Text style={typography.h2}>Sent successfully</Text>
          <Text style={[typography.body, { color:colors.textSecondary, marginTop:8, textAlign:'center' }]}>
            {amount} {token} sent to {toAddress.slice(0,8)}...{toAddress.slice(-6)}
          </Text>

          <Card style={{ marginTop:32, width:'100%' }}>
            <Row label="Amount" value={`${amount} ${token}`} />
            <Row label="Network" value={chain.toUpperCase()} />
            <Row label="Status" value="Pending confirmation" valueColor={colors.warning} />
            {txResult?.txHash && <Row label="Tx Hash" value={`${txResult.txHash.slice(0,10)}...`} mono />}
          </Card>

          <View style={{ flex:1 }} />
          <Button label="Done" onPress={() => navigation.navigate('Dashboard')} />
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'review') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Review" />
        <View style={styles.content}>
          <Card style={{ alignItems:'center', paddingVertical:32 }}>
            <TokenIcon token={token} size={56} />
            <Text style={[typography.h1, { marginTop:16 }]}>{amount} {token}</Text>
            <Text style={{ ...typography.sm, color:colors.textSecondary, marginTop:4 }}>≈ ₹{amount}</Text>
          </Card>

          <Card style={{ marginTop:spacing.lg }}>
            <Row label="To" value={`${toAddress.slice(0,10)}...${toAddress.slice(-6)}`} mono />
            <Row label="Network" value={chain.toUpperCase()} />
            <Row label="Available balance" value={`${availableBalance.toFixed(2)} ${token}`} />
            <Row label="Network fee" value="~0.001" last />
          </Card>

          <View style={{ flex:1 }} />
          <View style={{ gap:spacing.md }}>
            <Button label="Confirm & Send" onPress={handleSend} loading={loading} />
            <Button label="Edit" variant="ghost" onPress={() => setStep('form')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS==='ios'?'padding':undefined}>
      <SafeAreaView style={{ flex:1 }}>
        <Header title="Send" subtitle="Transfer tokens to any address" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* Token selector */}
          <Text style={styles.label}>Asset</Text>
          <View style={styles.tokenSelector}>
            {TOKENS.map(t => (
              <TouchableOpacity key={t} style={[styles.tokenChip, token===t && styles.tokenChipActive]} onPress={() => setToken(t)}>
                <TokenIcon token={t} size={28} />
                <Text style={[styles.tokenChipText, token===t && { color:colors.text }]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Chain selector */}
          <Text style={styles.label}>Network</Text>
          <View style={styles.chainSelector}>
            {CHAINS.map(c => (
              <TouchableOpacity key={c} style={[styles.chainChip, chain===c && styles.chainChipActive]} onPress={() => setChain(c)}>
                <ChainBadge chain={c} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Amount */}
          <View style={styles.amountSection}>
            <View style={styles.amountHeader}>
              <Text style={styles.label}>Amount</Text>
              <Text style={styles.balanceText}>Balance: {availableBalance.toFixed(4)} {token}</Text>
            </View>
            <View style={styles.amountInputWrap}>
              <Input
                placeholder="0.00"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                style={styles.amountInput}
              />
              <TouchableOpacity style={styles.maxBtn} onPress={() => setAmount(availableBalance.toString())}>
                <Text style={styles.maxBtnText}>MAX</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Recipient */}
          <Input
            label="Recipient Address"
            placeholder={`Enter ${chain} address`}
            value={toAddress}
            onChangeText={setToAddress}
            autoCapitalize="none"
            autoCorrect={false}
            rightIcon={
              <TouchableOpacity onPress={() => {/* QR scan */}}>
                <Ionicons name="scan-outline" size={20} color={colors.teal} />
              </TouchableOpacity>
            }
          />

          <View style={{ flex:1 }} />
          <Button
            label="Continue"
            onPress={() => setStep('review')}
            disabled={!toAddress || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > availableBalance}
          />
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
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
  content:   { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, flexGrow:1 },
  label:     { ...typography.sm, color:colors.textSecondary, fontWeight:'600', marginBottom:10, marginTop: spacing.lg },

  tokenSelector: { flexDirection:'row', gap:spacing.sm },
  tokenChip:  { flex:1, alignItems:'center', gap:6, padding:spacing.md, borderRadius:radius.lg,
                backgroundColor:colors.surface, borderWidth:1, borderColor:colors.border },
  tokenChipActive: { borderColor: colors.tealBorder, backgroundColor: colors.tealBg },
  tokenChipText: { ...typography.sm, color:colors.textSecondary, fontWeight:'700' },

  chainSelector: { flexDirection:'row', flexWrap:'wrap', gap:spacing.sm },
  chainChip:  { padding:8, borderRadius:radius.md, backgroundColor:colors.surface, borderWidth:1, borderColor:colors.border },
  chainChipActive: { borderColor: colors.tealBorder, backgroundColor: colors.tealBg },

  amountSection: { marginTop: spacing.lg },
  amountHeader:  { flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  balanceText:   { ...typography.xs, color:colors.textTertiary },
  amountInputWrap: { flexDirection:'row', alignItems:'center', gap:spacing.sm },
  amountInput:   { ...typography.h2, fontWeight:'700' },
  maxBtn:     { backgroundColor:colors.tealBg2, paddingHorizontal:14, paddingVertical:10, borderRadius:radius.md, marginBottom:spacing.md },
  maxBtnText: { ...typography.xs, color:colors.teal, fontWeight:'700' },

  row:       { flexDirection:'row', justifyContent:'space-between', paddingVertical:spacing.sm },
  rowBorder: { borderBottomWidth:1, borderBottomColor: colors.border },
  rowLabel:  { ...typography.sm, color:colors.textSecondary },
  rowValue:  { ...typography.sm, color:colors.text, fontWeight:'600' },

  successContainer: { flex:1, alignItems:'center', padding:spacing.xl, paddingTop:spacing.xxxxl },
  successIcon: { width:80, height:80, borderRadius:40, backgroundColor:colors.successBg,
                 alignItems:'center', justifyContent:'center', marginBottom:spacing.xl,
                 borderWidth:1, borderColor:colors.success+'40' },
});
