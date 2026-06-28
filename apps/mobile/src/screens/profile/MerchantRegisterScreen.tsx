import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components/ui/Header';
import { Input }  from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card }   from '../../components/ui/Card';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

const CHAINS = ['tron','ethereum','bsc','polygon'];

export default function MerchantRegisterScreen() {
  const navigation = useNavigation<any>();
  const [businessName, setBusinessName] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [gstin, setGstin] = useState('');
  const [settlementChain, setSettlementChain] = useState('tron');
  const [settlementAddress, setSettlementAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<any>(null);

  const handleRegister = async () => {
    if (!businessName || !settlementAddress) { Alert.alert('Missing fields', 'Business name and settlement address are required'); return; }
    setLoading(true);
    try {
      const res = await api.registerMerchant({ businessName, businessEmail: businessEmail||undefined, gstin: gstin||undefined, settlementChain, settlementAddress });
      setResult(res);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Merchant Registered" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.successSection}>
            <View style={styles.successIcon}><Ionicons name="storefront" size={36} color={colors.teal} /></View>
            <Text style={typography.h2}>You're a merchant!</Text>
            <Text style={styles.subtitle}>Save your API credentials — the secret is shown only once.</Text>
          </View>

          <Card style={{ gap:spacing.sm }}>
            <View style={styles.credRow}>
              <Text style={styles.credLabel}>API Key</Text>
              <Text style={styles.credValue} selectable>{result.apiKey}</Text>
            </View>
            <View style={[styles.credRow, { backgroundColor:colors.warningBg, borderRadius:radius.md, padding:spacing.sm }]}>
              <Text style={[styles.credLabel, { color:colors.warning }]}>API Secret (save now!)</Text>
              <Text style={[styles.credValue, { color:colors.warning }]} selectable>{result.apiSecret}</Text>
            </View>
          </Card>

          <View style={styles.warningBox}>
            <Ionicons name="warning" size={16} color={colors.warning} />
            <Text style={styles.warningText}>This is the only time your API secret will be displayed. Copy it now and store it securely.</Text>
          </View>

          <Button label="Done" onPress={() => navigation.goBack()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Merchant Registration" subtitle="Accept crypto payments from customers" />
      <ScrollView contentContainerStyle={styles.content}>
        <Input label="Business Name *" placeholder="Rahul Electronics" value={businessName} onChangeText={setBusinessName} />
        <Input label="Business Email" placeholder="support@yourbusiness.com" value={businessEmail} onChangeText={setBusinessEmail} keyboardType="email-address" autoCapitalize="none" />
        <Input label="GSTIN (optional)" placeholder="27AAAAA0000A1Z5" value={gstin} onChangeText={setGstin} autoCapitalize="characters" />

        <Text style={styles.label}>Settlement Network</Text>
        <View style={styles.chainSelector}>
          {CHAINS.map(c => (
            <TouchableOpacity key={c} style={[styles.chainChip, settlementChain===c && styles.chainChipActive]} onPress={() => setSettlementChain(c)}>
              <ChainBadge chain={c} />
            </TouchableOpacity>
          ))}
        </View>

        <Input label={`Settlement Address (${settlementChain.toUpperCase()}) *`} placeholder={`Your ${settlementChain} wallet address`} value={settlementAddress} onChangeText={setSettlementAddress} autoCapitalize="none" autoCorrect={false} />

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.info} />
          <Text style={styles.infoText}>Payments will be automatically sent to this address. You can change it later from your merchant profile.</Text>
        </View>

        <Button label="Register as Merchant" onPress={handleRegister} loading={loading} />
      </ScrollView>
    </SafeAreaView>
  );
}

const { TouchableOpacity } = require('react-native');

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:colors.bg },
  content:   { paddingHorizontal:spacing.xl, paddingBottom:spacing.xxxl },
  label:     { ...typography.sm, color:colors.textSecondary, fontWeight:'600', marginBottom:10, marginTop:spacing.lg },
  chainSelector: { flexDirection:'row', gap:spacing.sm, marginBottom:spacing.md },
  chainChip:  { padding:10, borderRadius:radius.md, backgroundColor:colors.surface, borderWidth:1, borderColor:colors.border },
  chainChipActive: { borderColor:colors.tealBorder, backgroundColor:colors.tealBg },
  infoBox:   { flexDirection:'row', gap:spacing.sm, backgroundColor:colors.infoBg, padding:spacing.md, borderRadius:radius.lg, marginTop:spacing.sm, alignItems:'flex-start', marginBottom:spacing.lg },
  infoText:  { ...typography.xs, color:colors.info, flex:1, lineHeight:18 },
  successSection: { alignItems:'center', paddingVertical:spacing.xl, gap:spacing.sm },
  successIcon:    { width:72, height:72, borderRadius:36, backgroundColor:colors.tealBg2, borderWidth:1, borderColor:colors.tealBorder, alignItems:'center', justifyContent:'center', marginBottom:spacing.md },
  subtitle:  { ...typography.sm, color:colors.textSecondary, textAlign:'center' },
  credRow:   { gap:4 },
  credLabel: { ...typography.xs, color:colors.textTertiary, fontWeight:'700' },
  credValue: { ...typography.mono, color:colors.text, fontSize:12 },
  warningBox:{ flexDirection:'row', gap:spacing.sm, backgroundColor:colors.warningBg, padding:spacing.md, borderRadius:radius.lg, marginVertical:spacing.lg, alignItems:'flex-start' },
  warningText:{ ...typography.xs, color:colors.warning, flex:1, lineHeight:18 },
});
