import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { api } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { colors, spacing, typography, radius } from '../../theme';

const TOKENS  = ['INRX','EGOLD','ESLVR'];
const CHAINS  = ['tron','ethereum','bsc','polygon'];

export function SendScreen({ navigation }: any) {
  const [token,     setToken]     = useState('INRX');
  const [chain,     setChain]     = useState('tron');
  const [toAddress, setToAddress] = useState('');
  const [amount,    setAmount]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [step,      setStep]      = useState<'form'|'confirm'>('form');

  const handleSend = async () => {
    if (!toAddress || !amount) { Alert.alert('Error','Fill all fields'); return; }
    setLoading(true);
    try {
      const result = await api.sendToken({ chain, toAddress, token, amount });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Sent!', `Transaction submitted: ${result.txHash?.slice(0,16)}...`, [
        { text:'OK', onPress:() => navigation.goBack() }
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS==='ios'?'padding':'height'}>
      <LinearGradient colors={[colors.bgSecondary, colors.bg]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Send Tokens</Text>
        <View style={{ width:32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

        {/* Token selector */}
        <Text style={styles.label}>Select Token</Text>
        <View style={styles.selectorRow}>
          {TOKENS.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.selectorItem, token===t && styles.selectorActive]}
              onPress={() => setToken(t)}
            >
              <TokenIcon token={t} size={28} />
              <Text style={[styles.selectorText, token===t && styles.selectorTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Chain selector */}
        <Text style={styles.label}>Network</Text>
        <View style={styles.chainRow}>
          {CHAINS.map(c => (
            <TouchableOpacity
              key={c}
              style={[styles.chainItem, chain===c && styles.chainItemActive]}
              onPress={() => setChain(c)}
            >
              <Text style={[styles.chainText, chain===c && styles.chainTextActive]}>
                {c.charAt(0).toUpperCase()+c.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Input label="Recipient Address" value={toAddress} onChangeText={setToAddress}
               placeholder="0x... or T..." autoCapitalize="none"
               rightIcon={
                 <TouchableOpacity onPress={() => navigation.navigate('Scan', { onScan:(v:string)=>setToAddress(v) })}>
                   <Text style={{ fontSize:20 }}>⊡</Text>
                 </TouchableOpacity>
               }
        />

        <Input label="Amount" value={amount} onChangeText={setAmount}
               placeholder="0.00" keyboardType="decimal-pad"
               hint={`Sending ${token} on ${chain}`}
               rightIcon={<Text style={{ color:colors.teal, fontSize:13, fontWeight:'600' }}>MAX</Text>}
        />

        {/* Fee estimate */}
        <View style={styles.feeCard}>
          <View style={styles.feeRow}>
            <Text style={styles.feeLabel}>Network fee</Text>
            <Text style={styles.feeValue}>~0.001 TRX</Text>
          </View>
          <View style={styles.feeRow}>
            <Text style={styles.feeLabel}>You receive</Text>
            <Text style={[styles.feeValue, { color:colors.teal }]}>{amount||'0'} {token}</Text>
          </View>
        </View>

        <Button label={`Send ${amount||'0'} ${token}`} onPress={handleSend} loading={loading} />

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:        { flex:1, backgroundColor:colors.bg },
  topBar:           { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                      paddingHorizontal:spacing.lg, paddingTop:60, paddingBottom:spacing.md },
  back:             { fontSize:26, color:colors.text, fontWeight:'300' },
  title:            { ...typography.h4, color:colors.text },
  body:             { padding:spacing.lg },
  label:            { ...typography.sm, color:colors.textSecondary, fontWeight:'600', marginBottom:spacing.sm, marginTop:spacing.md },
  selectorRow:      { flexDirection:'row', gap:spacing.sm, marginBottom:spacing.md },
  selectorItem:     { flex:1, flexDirection:'row', alignItems:'center', gap:8, padding:spacing.md,
                      backgroundColor:colors.surface, borderRadius:radius.lg, borderWidth:1, borderColor:colors.border },
  selectorActive:   { borderColor:colors.teal, backgroundColor:colors.tealBg },
  selectorText:     { ...typography.sm, color:colors.textSecondary, fontWeight:'600' },
  selectorTextActive:{ color:colors.teal },
  chainRow:         { flexDirection:'row', gap:spacing.xs, marginBottom:spacing.md },
  chainItem:        { flex:1, paddingVertical:10, paddingHorizontal:4, backgroundColor:colors.surface,
                      borderRadius:radius.md, borderWidth:1, borderColor:colors.border, alignItems:'center' },
  chainItemActive:  { borderColor:colors.teal, backgroundColor:colors.tealBg },
  chainText:        { ...typography.xs, color:colors.textSecondary, fontWeight:'600' },
  chainTextActive:  { color:colors.teal },
  feeCard:          { backgroundColor:colors.surface, borderRadius:radius.lg, borderWidth:1,
                      borderColor:colors.border, padding:spacing.lg, marginBottom:spacing.lg, gap:10 },
  feeRow:           { flexDirection:'row', justifyContent:'space-between' },
  feeLabel:         { ...typography.sm, color:colors.textSecondary },
  feeValue:         { ...typography.sm, color:colors.text, fontWeight:'600', fontFamily:'monospace' },
});
