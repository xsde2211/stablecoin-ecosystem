import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { api } from '../../services/api';
import { Button }    from '../../components/ui/Button';
import { Input }     from '../../components/ui/Input';
import { TokenIcon } from '../../components/ui/TokenIcon';
import { colors, spacing, typography, radius } from '../../theme';

const CHAINS  = ['tron','ethereum','bsc','polygon'];
const TOKENS  = ['INRX','EGOLD','ESLVR'];

const CHAIN_LABELS: Record<string,string> = {
  tron:'TRON', ethereum:'Ethereum', bsc:'BSC', polygon:'Polygon',
};

function ChainSelector({
  label, value, onChange, exclude,
}: { label:string; value:string; onChange:(v:string)=>void; exclude:string }) {
  return (
    <View style={{ flex:1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {CHAINS.filter(c => c !== exclude).map(c => (
        <TouchableOpacity
          key={c}
          style={[styles.chainOption, value===c && styles.chainOptionActive]}
          onPress={() => onChange(c)}
        >
          <View style={[styles.chainDot, { backgroundColor: {
            tron:'#EF0027', ethereum:'#627EEA', bsc:'#F0B90B', polygon:'#8247E5',
          }[c] }]} />
          <Text style={[styles.chainOptionText, value===c && { color:colors.teal }]}>
            {CHAIN_LABELS[c]}
          </Text>
          {value===c && <Text style={{ color:colors.teal, marginLeft:'auto' }}>✓</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function BridgeScreen({ navigation }: any) {
  const [srcChain,    setSrcChain]    = useState('tron');
  const [dstChain,    setDstChain]    = useState('ethereum');
  const [token,       setToken]       = useState('INRX');
  const [amount,      setAmount]      = useState('');
  const [dstAddress,  setDstAddress]  = useState('');
  const [loading,     setLoading]     = useState(false);
  const [step,        setStep]        = useState<'form'|'confirm'|'pending'>('form');
  const [txResult,    setTxResult]    = useState<any>(null);

  const swapChains = () => {
    const tmp = srcChain;
    setSrcChain(dstChain);
    setDstChain(tmp);
  };

  const handleBridge = async () => {
    if (!amount || !dstAddress) { Alert.alert('Error','Fill all fields'); return; }
    if (srcChain === dstChain)  { Alert.alert('Error','Source and destination must differ'); return; }
    setLoading(true);
    try {
      const result = await api.initiateBridge({ srcChain, dstChain, token, amount, dstAddress });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTxResult(result);
      setStep('pending');
    } catch (e: any) {
      Alert.alert('Bridge Error', e?.response?.data?.message ?? 'Failed to initiate bridge');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'pending' && txResult) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={[colors.bgSecondary, colors.bg]} style={StyleSheet.absoluteFill} />
        <View style={styles.successContainer}>
          <LinearGradient colors={[colors.tealBg, 'transparent']} style={styles.successGlow} />
          <View style={styles.successIcon}>
            <Text style={{ fontSize:40 }}>⇄</Text>
          </View>
          <Text style={styles.successTitle}>Bridge Initiated</Text>
          <Text style={styles.successSubtitle}>
            {amount} {token} · {CHAIN_LABELS[srcChain]} → {CHAIN_LABELS[dstChain]}
          </Text>
          <View style={styles.successCard}>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Transfer ID</Text>
              <Text style={styles.successValue} numberOfLines={1}>
                {txResult.id?.slice(0,16)}...
              </Text>
            </View>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Status</Text>
              <Text style={[styles.successValue, { color:colors.warning }]}>
                Collecting signatures
              </Text>
            </View>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Est. time</Text>
              <Text style={styles.successValue}>5–15 minutes</Text>
            </View>
          </View>
          <View style={styles.stepsCard}>
            {['Lock on source chain','Validator signatures','Mint on destination'].map((s,i) => (
              <View key={i} style={styles.stepRow}>
                <View style={[styles.stepNum, i===0 && styles.stepActive]}>
                  <Text style={styles.stepNumText}>{i+1}</Text>
                </View>
                <Text style={[styles.stepText, i===0 && { color:colors.teal }]}>{s}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.doneBtn} onPress={() => { setStep('form'); navigation.goBack(); }}>
            <Text style={styles.doneBtnText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS==='ios'?'padding':'height'}>
      <LinearGradient colors={[colors.bgSecondary, colors.bg]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Cross-Chain Bridge</Text>
        <View style={{ width:32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

        {/* Token selector */}
        <Text style={styles.fieldLabel}>Token</Text>
        <View style={styles.tokenRow}>
          {TOKENS.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tokenOption, token===t && styles.tokenOptionActive]}
              onPress={() => setToken(t)}
            >
              <TokenIcon token={t} size={28} />
              <Text style={[styles.tokenOptionText, token===t && { color:colors.teal }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Chain selectors */}
        <View style={styles.chainSelectContainer}>
          <View style={{ flex:1 }}>
            <Text style={styles.fieldLabel}>From</Text>
            {CHAINS.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.chainOption, srcChain===c && styles.chainOptionActive]}
                onPress={() => { setSrcChain(c); if(c===dstChain) setDstChain(CHAINS.find(x=>x!==c)!); }}
              >
                <View style={[styles.chainDot, { backgroundColor:{tron:'#EF0027',ethereum:'#627EEA',bsc:'#F0B90B',polygon:'#8247E5'}[c] }]} />
                <Text style={[styles.chainOptionText, srcChain===c && { color:colors.teal }]}>{CHAIN_LABELS[c]}</Text>
                {srcChain===c && <Text style={{ color:colors.teal, marginLeft:'auto' }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>

          {/* Swap button */}
          <TouchableOpacity style={styles.swapBtn} onPress={swapChains}>
            <LinearGradient colors={[colors.teal, colors.tealDim]} style={styles.swapGradient}>
              <Text style={styles.swapIcon}>⇄</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={{ flex:1 }}>
            <Text style={styles.fieldLabel}>To</Text>
            {CHAINS.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.chainOption, dstChain===c && styles.chainOptionActive,
                        c===srcChain && styles.chainOptionDisabled]}
                onPress={() => { if(c!==srcChain) setDstChain(c); }}
                disabled={c===srcChain}
              >
                <View style={[styles.chainDot, { backgroundColor:{tron:'#EF0027',ethereum:'#627EEA',bsc:'#F0B90B',polygon:'#8247E5'}[c] }]} />
                <Text style={[styles.chainOptionText, dstChain===c && { color:colors.teal },
                              c===srcChain && { color:colors.textTertiary }]}>{CHAIN_LABELS[c]}</Text>
                {dstChain===c && <Text style={{ color:colors.teal, marginLeft:'auto' }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Input label="Amount" value={amount} onChangeText={setAmount}
               keyboardType="decimal-pad" placeholder="0.00"
               hint={`Bridging ${token} from ${CHAIN_LABELS[srcChain]} to ${CHAIN_LABELS[dstChain]}`} />

        <Input label="Destination Address" value={dstAddress} onChangeText={setDstAddress}
               placeholder="Recipient address on destination chain" autoCapitalize="none" />

        {/* Info card */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Bridge fee</Text>
            <Text style={styles.infoValue}>0.1%</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Est. time</Text>
            <Text style={styles.infoValue}>5–15 min</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Validators required</Text>
            <Text style={styles.infoValue}>2 of 3</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>You receive</Text>
            <Text style={[styles.infoValue, { color:colors.teal }]}>
              {amount ? (parseFloat(amount)*0.999).toFixed(6) : '0'} {token}
            </Text>
          </View>
        </View>

        <Button label="Initiate Bridge Transfer" onPress={handleBridge} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:          { flex:1, backgroundColor:colors.bg },
  topBar:             { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                        paddingHorizontal:spacing.lg, paddingTop:60, paddingBottom:spacing.md },
  back:               { fontSize:26, color:colors.text, fontWeight:'300' },
  title:              { ...typography.h4, color:colors.text },
  body:               { padding:spacing.lg },
  fieldLabel:         { ...typography.sm, color:colors.textSecondary, fontWeight:'600',
                        marginBottom:spacing.sm, marginTop:spacing.md },
  tokenRow:           { flexDirection:'row', gap:spacing.sm, marginBottom:spacing.sm },
  tokenOption:        { flex:1, flexDirection:'row', alignItems:'center', gap:8, padding:spacing.md,
                        backgroundColor:colors.surface, borderRadius:radius.lg,
                        borderWidth:1, borderColor:colors.border },
  tokenOptionActive:  { borderColor:colors.teal, backgroundColor:colors.tealBg },
  tokenOptionText:    { ...typography.sm, color:colors.textSecondary, fontWeight:'700' },
  chainSelectContainer:{ flexDirection:'row', gap:spacing.sm, alignItems:'flex-start', marginBottom:spacing.md },
  chainOption:        { flexDirection:'row', alignItems:'center', gap:8, padding:spacing.md,
                        backgroundColor:colors.surface, borderRadius:radius.lg,
                        borderWidth:1, borderColor:colors.border, marginBottom:spacing.xs },
  chainOptionActive:  { borderColor:colors.teal, backgroundColor:colors.tealBg },
  chainOptionDisabled:{ opacity:0.35 },
  chainOptionText:    { ...typography.sm, color:colors.textSecondary, fontWeight:'600', flex:1 },
  chainDot:           { width:8, height:8, borderRadius:4 },
  swapBtn:            { alignSelf:'center', marginTop:spacing.xl },
  swapGradient:       { width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  swapIcon:           { fontSize:18, color:'#000', fontWeight:'800' },
  infoCard:           { backgroundColor:colors.surface, borderRadius:radius.lg, borderWidth:1,
                        borderColor:colors.border, padding:spacing.lg, gap:10, marginBottom:spacing.lg },
  infoRow:            { flexDirection:'row', justifyContent:'space-between' },
  infoLabel:          { ...typography.sm, color:colors.textSecondary },
  infoValue:          { ...typography.sm, color:colors.text, fontWeight:'600' },
  // Success state
  successContainer:   { flex:1, padding:spacing.lg, paddingTop:100, alignItems:'center' },
  successGlow:        { ...StyleSheet.absoluteFillObject, borderRadius:999 },
  successIcon:        { width:80, height:80, borderRadius:40, backgroundColor:colors.tealBg,
                        alignItems:'center', justifyContent:'center', marginBottom:spacing.lg,
                        borderWidth:1, borderColor:colors.teal },
  successTitle:       { ...typography.h2, color:colors.text, marginBottom:8 },
  successSubtitle:    { ...typography.body, color:colors.textSecondary, marginBottom:spacing.xl, textAlign:'center' },
  successCard:        { backgroundColor:colors.surface, borderRadius:radius.xl, borderWidth:1,
                        borderColor:colors.border, padding:spacing.lg, width:'100%', marginBottom:spacing.lg },
  successRow:         { flexDirection:'row', justifyContent:'space-between', marginBottom:spacing.sm },
  successLabel:       { ...typography.sm, color:colors.textSecondary },
  successValue:       { ...typography.sm, color:colors.text, fontWeight:'600', fontFamily:'monospace' },
  stepsCard:          { backgroundColor:colors.surface, borderRadius:radius.xl, borderWidth:1,
                        borderColor:colors.border, padding:spacing.lg, width:'100%', marginBottom:spacing.xl, gap:spacing.md },
  stepRow:            { flexDirection:'row', alignItems:'center', gap:12 },
  stepNum:            { width:28, height:28, borderRadius:14, backgroundColor:colors.bgTertiary,
                        borderWidth:1, borderColor:colors.border, alignItems:'center', justifyContent:'center' },
  stepActive:         { backgroundColor:colors.tealBg, borderColor:colors.teal },
  stepNumText:        { ...typography.xs, color:colors.textSecondary, fontWeight:'700' },
  stepText:           { ...typography.sm, color:colors.textSecondary },
  doneBtn:            { backgroundColor:colors.tealBg, borderRadius:radius.lg, paddingVertical:16,
                        paddingHorizontal:40, borderWidth:1, borderColor:colors.teal },
  doneBtnText:        { ...typography.body, color:colors.teal, fontWeight:'700' },
});
