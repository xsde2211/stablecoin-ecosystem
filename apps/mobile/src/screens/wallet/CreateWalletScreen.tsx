import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useDispatch } from 'react-redux';
import { fetchAddresses, fetchBalances } from '../../store/slices/walletSlice';
import { AppDispatch } from '../../store';
import { api } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { colors, spacing, typography, radius } from '../../theme';

type Step = 'choose'|'creating'|'backup'|'import';

export function CreateWalletScreen({ navigation }: any) {
  const dispatch  = useDispatch<AppDispatch>();
  const [step,     setStep]     = useState<Step>('choose');
  const [mnemonic, setMnemonic] = useState('');
  const [importPhrase, setImportPhrase] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading,  setLoading]  = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const result = await api.createWallet();
      setMnemonic(result.mnemonic);
      setStep('backup');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to create wallet');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importPhrase.trim()) { Alert.alert('Error','Enter your seed phrase'); return; }
    setLoading(true);
    try {
      await api.importWallet({ mnemonic: importPhrase.trim() });
      dispatch(fetchAddresses());
      dispatch(fetchBalances());
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Wallet Imported','Your wallet has been imported successfully.', [
        { text:'Continue', onPress:() => navigation.replace('MainTabs') }
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'Invalid seed phrase');
    } finally {
      setLoading(false);
    }
  };

  const handleBackupDone = async () => {
    if (!confirmed) { Alert.alert('Please confirm','Tick the checkbox to confirm you saved the phrase'); return; }
    dispatch(fetchAddresses());
    dispatch(fetchBalances());
    navigation.replace('MainTabs');
  };

  if (step === 'backup') {
    const words = mnemonic.split(' ');
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#0A0A0F','#111118']} style={StyleSheet.absoluteFill} />
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.warningBanner}>
            <Text style={styles.warningBannerText}>
              🔐 Write this down — it will NEVER be shown again
            </Text>
          </View>
          <Text style={styles.backupTitle}>Your Seed Phrase</Text>
          <Text style={styles.backupSubtitle}>
            24 words · Store offline · Never share with anyone
          </Text>
          <View style={styles.wordGrid}>
            {words.map((w, i) => (
              <View key={i} style={styles.wordCell}>
                <Text style={styles.wordNum}>{i+1}</Text>
                <Text style={styles.wordText}>{w}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.copyRow}
            onPress={async () => { await Clipboard.setStringAsync(mnemonic); Alert.alert('Copied!','Clear clipboard after saving.'); }}>
            <Text style={styles.copyText}>⎘ Copy all words</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmRow} onPress={() => setConfirmed(!confirmed)}>
            <View style={[styles.checkbox, confirmed && styles.checkboxOn]}>
              {confirmed && <Text style={{ color:'#000', fontWeight:'800', fontSize:11 }}>✓</Text>}
            </View>
            <Text style={styles.confirmText}>
              I have written down all 24 words in the correct order
            </Text>
          </TouchableOpacity>
          <Button label="I've Saved My Phrase" onPress={handleBackupDone} />
        </ScrollView>
      </View>
    );
  }

  if (step === 'import') {
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#0A0A0F','#111118']} style={StyleSheet.absoluteFill} />
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setStep('choose')}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>Import Wallet</Text>
          <View style={{ width:32 }} />
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.importTitle}>Enter Seed Phrase</Text>
          <Text style={styles.importSubtitle}>
            Enter your 12 or 24 word recovery phrase, separated by spaces
          </Text>
          <View style={styles.phraseInput}>
            <TextInput
              value={importPhrase}
              onChangeText={setImportPhrase}
              multiline
              numberOfLines={6}
              placeholder="word1 word2 word3 ..."
              placeholderTextColor={colors.textTertiary}
              style={styles.phraseInputText}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.importNotice}>
            <Text style={styles.importNoticeText}>
              🔒 Your phrase is encrypted and never leaves your device unencrypted.
            </Text>
          </View>
          <Button label="Import Wallet" onPress={handleImport} loading={loading} />
        </ScrollView>
      </View>
    );
  }

  // Choose step
  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0A0A0F','#111118']} style={StyleSheet.absoluteFill} />
      <ScrollView contentContainerStyle={[styles.body, { paddingTop:100 }]}>
        <View style={styles.logoWrap}>
          <View style={styles.logo}>
            <Text style={{ fontSize:36, color:colors.teal }}>◈</Text>
          </View>
          <Text style={styles.chooseTitle}>Set Up Your Wallet</Text>
          <Text style={styles.chooseSubtitle}>
            Create a new self-custody wallet or restore an existing one
          </Text>
        </View>

        <TouchableOpacity style={styles.optionCard} onPress={handleCreate} disabled={loading}
                          activeOpacity={0.85}>
          <LinearGradient colors={[colors.tealBg, 'transparent']} style={styles.optionGradient}>
            <View style={styles.optionIcon}><Text style={{ fontSize:28 }}>✦</Text></View>
            <View style={{ flex:1 }}>
              <Text style={styles.optionTitle}>Create New Wallet</Text>
              <Text style={styles.optionDesc}>
                Generate a brand-new wallet with a 24-word seed phrase
              </Text>
            </View>
            <Text style={styles.optionArrow}>→</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={styles.optionCard} onPress={() => setStep('import')} activeOpacity={0.85}>
          <View style={styles.optionGradient}>
            <View style={styles.optionIcon}><Text style={{ fontSize:28 }}>↩</Text></View>
            <View style={{ flex:1 }}>
              <Text style={styles.optionTitle}>Import Existing Wallet</Text>
              <Text style={styles.optionDesc}>
                Restore using your 12 or 24-word recovery phrase
              </Text>
            </View>
            <Text style={styles.optionArrow}>→</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          By continuing you agree to our Terms of Service. Your private keys are encrypted and stored securely on your device.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:        { flex:1, backgroundColor:colors.bg },
  topBar:           { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                      paddingHorizontal:spacing.lg, paddingTop:60, paddingBottom:spacing.md },
  back:             { fontSize:26, color:colors.text, fontWeight:'300' },
  topTitle:         { ...typography.h4, color:colors.text },
  body:             { padding:spacing.lg, paddingBottom:60 },
  logoWrap:         { alignItems:'center', marginBottom:spacing.xxxl },
  logo:             { width:72, height:72, borderRadius:36, backgroundColor:colors.tealBg,
                      borderWidth:1.5, borderColor:colors.teal, alignItems:'center',
                      justifyContent:'center', marginBottom:spacing.lg },
  chooseTitle:      { ...typography.h2, color:colors.text, marginBottom:8, textAlign:'center' },
  chooseSubtitle:   { ...typography.body, color:colors.textSecondary, textAlign:'center' },
  optionCard:       { borderRadius:radius.xxl, borderWidth:1, borderColor:colors.border,
                      overflow:'hidden', marginBottom:spacing.md },
  optionGradient:   { flexDirection:'row', alignItems:'center', padding:spacing.xl, gap:spacing.md },
  optionIcon:       { width:52, height:52, borderRadius:radius.lg, backgroundColor:colors.surface,
                      alignItems:'center', justifyContent:'center', borderWidth:1, borderColor:colors.border },
  optionTitle:      { ...typography.h4, color:colors.text, marginBottom:4 },
  optionDesc:       { ...typography.sm, color:colors.textSecondary, lineHeight:18 },
  optionArrow:      { fontSize:20, color:colors.textTertiary },
  disclaimer:       { ...typography.xs, color:colors.textTertiary, textAlign:'center',
                      marginTop:spacing.xl, lineHeight:18 },
  // Backup step
  warningBanner:    { backgroundColor:colors.errorBg, borderRadius:radius.lg, padding:spacing.md,
                      borderWidth:1, borderColor:colors.error+'44', marginBottom:spacing.xl },
  warningBannerText:{ ...typography.sm, color:colors.error, fontWeight:'700', textAlign:'center' },
  backupTitle:      { ...typography.h3, color:colors.text, marginBottom:4 },
  backupSubtitle:   { ...typography.sm, color:colors.textSecondary, marginBottom:spacing.xl },
  wordGrid:         { flexDirection:'row', flexWrap:'wrap', gap:spacing.sm, marginBottom:spacing.lg },
  wordCell:         { width:'30%', backgroundColor:colors.surface, borderRadius:radius.md,
                      borderWidth:1, borderColor:colors.border, padding:spacing.sm,
                      flexDirection:'row', alignItems:'center', gap:6 },
  wordNum:          { ...typography.xs, color:colors.textTertiary, width:20, textAlign:'right' },
  wordText:         { ...typography.sm, color:colors.text, fontWeight:'600' },
  copyRow:          { alignItems:'center', marginBottom:spacing.lg, paddingVertical:12,
                      backgroundColor:colors.surface, borderRadius:radius.lg,
                      borderWidth:1, borderColor:colors.border },
  copyText:         { ...typography.sm, color:colors.teal, fontWeight:'700' },
  confirmRow:       { flexDirection:'row', gap:12, alignItems:'flex-start', marginBottom:spacing.xl },
  checkbox:         { width:22, height:22, borderRadius:6, borderWidth:1.5,
                      borderColor:colors.border, alignItems:'center', justifyContent:'center', marginTop:2 },
  checkboxOn:       { backgroundColor:colors.teal, borderColor:colors.teal },
  confirmText:      { ...typography.sm, color:colors.textSecondary, flex:1, lineHeight:20 },
  // Import step
  importTitle:      { ...typography.h3, color:colors.text, marginBottom:6 },
  importSubtitle:   { ...typography.body, color:colors.textSecondary, marginBottom:spacing.xl },
  phraseInput:      { backgroundColor:colors.surface, borderRadius:radius.xl, borderWidth:1,
                      borderColor:colors.border, padding:spacing.lg, marginBottom:spacing.lg, minHeight:130 },
  phraseInputText:  { ...typography.body, color:colors.text, lineHeight:26 },
  importNotice:     { backgroundColor:colors.tealBg, borderRadius:radius.lg, padding:spacing.lg,
                      marginBottom:spacing.lg, borderWidth:1, borderColor:colors.tealBorder },
  importNoticeText: { ...typography.sm, color:colors.teal, lineHeight:20 },
});
