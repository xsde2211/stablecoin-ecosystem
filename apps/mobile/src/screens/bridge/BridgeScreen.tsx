import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, Alert,
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

type Mode = 'lock'|'burn';

export default function BridgeScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { balances } = useSelector((s: RootState) => s.wallet);

  const [mode, setMode]   = useState<Mode>('lock');
  const [token, setToken] = useState(route.params?.token ?? 'INRX');
  const [srcChain, setSrcChain] = useState('tron');
  const [dstChain, setDstChain] = useState('ethereum');
  const [amount, setAmount]     = useState('');
  const [dstAddress, setDstAddress] = useState('');
  const [loading, setLoading]   = useState(false);
  const [step, setStep]         = useState<'form'|'success'>('form');

  const balance = (balances ?? []).find((b:any) => b.symbol === token && b.chain === srcChain);
  const availableBalance = parseFloat(balance?.balance ?? '0');

  const swapChains = () => {
    const tmp = srcChain;
    setSrcChain(dstChain);
    setDstChain(tmp);
  };

  const handleBridge = async () => {
    setLoading(true);
    try {
      if (mode === 'lock') {
        await api.initiateBridge({ srcChain, dstChain, token, amount, dstAddress });
      } else {
        await api.burnBridge({ chain: srcChain, token, amount, srcChain: dstChain, srcRecipient: dstAddress });
      }
      setStep('success');
    } catch (err: any) {
      Alert.alert('Bridge failed', err?.response?.data?.message || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'success') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="swap-horizontal" size={36} color={colors.teal} />
          </View>
          <Text style={typography.h2}>Bridge Initiated</Text>
          <Text style={[typography.body, { color:colors.textSecondary, marginTop:8, textAlign:'center' }]}>
            {amount} {token} is being transferred from {srcChain.toUpperCase()} to {dstChain.toUpperCase()}.{'\n\n'}
            This typically takes a few minutes while validators confirm the transfer.
          </Text>
          <View style={{ flex:1 }} />
          <Button label="View Bridge History" variant="secondary" onPress={() => navigation.navigate('BridgeHistory')} />
          <View style={{ height:spacing.md }} />
          <Button label="Done" onPress={() => navigation.navigate('Dashboard')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Bridge" subtitle="Move assets across chains" rightIcon="time-outline" onRightPress={() => navigation.navigate('BridgeHistory')} />
      <ScrollView contentContainerStyle={styles.content}>

        {/* Mode tabs */}
        <View style={styles.modeTabs}>
          <TouchableOpacity style={[styles.modeTab, mode==='lock' && styles.modeTabActive]} onPress={() => setMode('lock')}>
            <Text style={[styles.modeTabText, mode==='lock' && styles.modeTabTextActive]}>Bridge Out</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeTab, mode==='burn' && styles.modeTabActive]} onPress={() => setMode('burn')}>
            <Text style={[styles.modeTabText, mode==='burn' && styles.modeTabTextActive]}>Bridge Back</Text>
          </TouchableOpacity>
        </View>

        {/* Token */}
        <Text style={styles.label}>Asset</Text>
        <View style={styles.tokenSelector}>
          {TOKENS.map(t => (
            <TouchableOpacity key={t} style={[styles.tokenChip, token===t && styles.tokenChipActive]} onPress={() => setToken(t)}>
              <TokenIcon token={t} size={28} />
              <Text style={[styles.tokenChipText, token===t && { color:colors.text }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Chain flow */}
        <View style={styles.chainFlow}>
          <View style={styles.chainBox}>
            <Text style={styles.chainLabel}>From</Text>
            <View style={styles.chainPicker}>
              {CHAINS.map(c => (
                <TouchableOpacity key={c} onPress={() => setSrcChain(c)} style={[styles.chainOption, srcChain===c && styles.chainOptionActive]}>
                  <ChainBadge chain={c} size="xs" />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.swapBtn} onPress={swapChains}>
            <Ionicons name="swap-horizontal" size={18} color={colors.teal} />
          </TouchableOpacity>

          <View style={styles.chainBox}>
            <Text style={styles.chainLabel}>To</Text>
            <View style={styles.chainPicker}>
              {CHAINS.filter(c=>c!==srcChain).map(c => (
                <TouchableOpacity key={c} onPress={() => setDstChain(c)} style={[styles.chainOption, dstChain===c && styles.chainOptionActive]}>
                  <ChainBadge chain={c} size="xs" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Amount */}
        <View style={styles.amountSection}>
          <View style={styles.amountHeader}>
            <Text style={styles.label}>Amount</Text>
            <Text style={styles.balanceText}>Balance: {availableBalance.toFixed(4)} {token}</Text>
          </View>
          <View style={styles.amountInputWrap}>
            <Input placeholder="0.00" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={styles.amountInput} />
            <TouchableOpacity style={styles.maxBtn} onPress={() => setAmount(availableBalance.toString())}>
              <Text style={styles.maxBtnText}>MAX</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Destination address */}
        <Input
          label={`Recipient address on ${dstChain.toUpperCase()}`}
          placeholder={`Your ${dstChain} wallet address`}
          value={dstAddress}
          onChangeText={setDstAddress}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Info */}
        <View style={styles.infoBox}>
          <Ionicons name="time-outline" size={16} color={colors.info} />
          <Text style={styles.infoText}>
            Bridge transfers require validator confirmation and typically complete within 5-15 minutes.
          </Text>
        </View>

        <View style={{ flex:1 }} />
        <Button
          label={mode==='lock' ? 'Bridge Out' : 'Bridge Back'}
          onPress={handleBridge}
          loading={loading}
          disabled={!amount || !dstAddress || parseFloat(amount) <= 0 || parseFloat(amount) > availableBalance}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor: colors.bg },
  content:   { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, flexGrow:1 },
  label:     { ...typography.sm, color:colors.textSecondary, fontWeight:'600', marginBottom:10, marginTop: spacing.lg },

  modeTabs:  { flexDirection:'row', backgroundColor:colors.surface, borderRadius:radius.lg, padding:4, borderWidth:1, borderColor:colors.border },
  modeTab:   { flex:1, paddingVertical:10, alignItems:'center', borderRadius:radius.md },
  modeTabActive: { backgroundColor:colors.tealBg2 },
  modeTabText: { ...typography.sm, color:colors.textSecondary, fontWeight:'700' },
  modeTabTextActive: { color:colors.teal },

  tokenSelector: { flexDirection:'row', gap:spacing.sm },
  tokenChip:  { flex:1, alignItems:'center', gap:6, padding:spacing.md, borderRadius:radius.lg,
                backgroundColor:colors.surface, borderWidth:1, borderColor:colors.border },
  tokenChipActive: { borderColor: colors.tealBorder, backgroundColor: colors.tealBg },
  tokenChipText: { ...typography.sm, color:colors.textSecondary, fontWeight:'700' },

  chainFlow: { flexDirection:'row', alignItems:'flex-end', gap:spacing.sm, marginTop:spacing.lg },
  chainBox:  { flex:1 },
  chainLabel:{ ...typography.xs, color:colors.textTertiary, marginBottom:8 },
  chainPicker: { flexDirection:'row', flexWrap:'wrap', gap:6, backgroundColor:colors.surface, padding:8, borderRadius:radius.md, borderWidth:1, borderColor:colors.border, minHeight:46 },
  chainOption: { padding:2, borderRadius:radius.sm },
  chainOptionActive: { backgroundColor:colors.tealBg },
  swapBtn:   { width:36, height:36, borderRadius:18, backgroundColor:colors.tealBg2, borderWidth:1, borderColor:colors.tealBorder,
               alignItems:'center', justifyContent:'center', marginBottom:30 },

  amountSection: { marginTop: spacing.lg },
  amountHeader:  { flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  balanceText:   { ...typography.xs, color:colors.textTertiary },
  amountInputWrap: { flexDirection:'row', alignItems:'center', gap:spacing.sm },
  amountInput:   { ...typography.h2, fontWeight:'700' },
  maxBtn:     { backgroundColor:colors.tealBg2, paddingHorizontal:14, paddingVertical:10, borderRadius:radius.md, marginBottom:spacing.md },
  maxBtnText: { ...typography.xs, color:colors.teal, fontWeight:'700' },

  infoBox: { flexDirection:'row', gap:spacing.sm, backgroundColor:colors.infoBg, padding:spacing.md,
             borderRadius:radius.lg, marginTop:spacing.md, alignItems:'flex-start' },
  infoText: { ...typography.xs, color:colors.info, flex:1, lineHeight:18 },

  successContainer: { flex:1, alignItems:'center', padding:spacing.xl, paddingTop:spacing.xxxxl },
  successIcon: { width:80, height:80, borderRadius:40, backgroundColor:colors.tealBg2,
                 alignItems:'center', justifyContent:'center', marginBottom:spacing.xl,
                 borderWidth:1, borderColor:colors.tealBorder },
});
