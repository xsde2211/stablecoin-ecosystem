import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, Alert, Clipboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDispatch } from 'react-redux';
import { Button } from '../../components/ui/Button';
import { Card }   from '../../components/ui/Card';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import {setWalletReady} from '../../store/slices/walletSlice';
import type { AppDispatch } from '../../store';

/**
 * Shown once, right after registration.
 * User chooses: create new wallet (shows mnemonic ONCE) or import existing.
 */
export default function WalletSetupScreen() {
  const dispatch = useDispatch<AppDispatch>();

  const [step, setStep]       = useState<'choice'|'create'|'import'|'confirm'>('choice');
  const [mnemonic, setMnemonic] = useState<string[]>([]);
  const [importPhrase, setImportPhrase] = useState('');
  const [confirmWords, setConfirmWords] = useState<{idx:number, word:string}[]>([]);
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await api.createWallet();
      const words = res.mnemonic.split(' ');
      setMnemonic(words);
      // Pick 3 random indices to confirm
      const indices = [...Array(words.length).keys()].sort(() => Math.random()-0.5).slice(0,3).sort((a,b)=>a-b);
      setConfirmWords(indices.map(idx => ({ idx, word: words[idx] })));
      setStep('create');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to create wallet');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    const words = importPhrase.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      Alert.alert('Invalid phrase', 'Seed phrase must be 12 or 24 words');
      return;
    }
    setLoading(true);
    try {
      await api.importWallet({ mnemonic: importPhrase.trim() });
      dispatch(setWalletReady(true));
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to import wallet');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmComplete = () => {
    const correct = confirmWords.every((cw, i) => selectedWords[i] === cw.word);
    if (!correct) {
      Alert.alert('Not quite right', 'Please tap the words in the order shown on your backup.');
      return;
    }
    dispatch(setWalletReady(true));
  };

  // ─── Choice screen ────────────────────────────────────────────────────────
  if (step === 'choice') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <View style={styles.iconCircle}>
            <Ionicons name="wallet-outline" size={36} color={colors.teal} />
          </View>
          <Text style={typography.h2}>Set up your wallet</Text>
          <Text style={[typography.body, styles.subtitle]}>
            Your wallet holds INRX, eGold & eSilver across TRON, Ethereum, BSC, Polygon and Solana — all from one seed phrase.
          </Text>
        </View>

        <View style={styles.actions}>
          <Button label="Create New Wallet" onPress={handleCreate} loading={loading} icon={<Ionicons name="add-circle" size={18} color="#000" />} />
          <View style={{ height: spacing.md }} />
          <Button label="Import Existing Wallet" variant="secondary" onPress={() => setStep('import')} />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Import screen ────────────────────────────────────────────────────────
  if (step === 'import') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={{ flexGrow:1 }}>
          <TouchableOpacity onPress={() => setStep('choice')} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <Text style={typography.h2}>Import wallet</Text>
          <Text style={[typography.body, { color:colors.textSecondary, marginTop:8, marginBottom:24 }]}>
            Enter your 12 or 24-word recovery phrase, separated by spaces.
          </Text>

          <Card>
            <TouchableOpacity activeOpacity={1}>
              <Text
                style={styles.importInput}
                onPress={() => {}}
              >
                {importPhrase || 'word1 word2 word3 ...'}
              </Text>
            </TouchableOpacity>
          </Card>

          {/* Using a real multiline input via Input component pattern */}
          <ImportInput value={importPhrase} onChange={setImportPhrase} />

          <View style={{ flex:1 }} />
          <Button label="Import Wallet" onPress={handleImport} loading={loading} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Create — reveal mnemonic ─────────────────────────────────────────────
  if (step === 'create') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={{ flexGrow:1 }}>
          <View style={styles.warningBox}>
            <Ionicons name="warning" size={20} color={colors.warning} />
            <Text style={styles.warningText}>
              Write these 24 words down and store them safely. Anyone with this phrase can access your funds. This is shown only once.
            </Text>
          </View>

          {!revealed ? (
            <Card style={{ alignItems:'center', paddingVertical:48 }}>
              <Ionicons name="eye-off-outline" size={32} color={colors.textTertiary} style={{ marginBottom:12 }} />
              <Text style={[typography.body, { color:colors.textSecondary, marginBottom:20, textAlign:'center' }]}>
                Tap to reveal your recovery phrase
              </Text>
              <Button label="Reveal Phrase" variant="secondary" onPress={() => setRevealed(true)} fullWidth={false} />
            </Card>
          ) : (
            <View style={styles.mnemonicGrid}>
              {mnemonic.map((word, i) => (
                <View key={i} style={styles.mnemonicChip}>
                  <Text style={styles.mnemonicIndex}>{i+1}</Text>
                  <Text style={styles.mnemonicWord}>{word}</Text>
                </View>
              ))}
            </View>
          )}

          {revealed && (
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => { Clipboard.setString(mnemonic.join(' ')); Alert.alert('Copied', 'Recovery phrase copied to clipboard'); }}
            >
              <Ionicons name="copy-outline" size={16} color={colors.teal} />
              <Text style={styles.copyText}>Copy to clipboard</Text>
            </TouchableOpacity>
          )}

          <View style={{ flex:1 }} />
          <Button label="I've saved my phrase" onPress={() => setStep('confirm')} disabled={!revealed} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Confirm ──────────────────────────────────────────────────────────────
  const shuffledOptions = [...confirmWords.map(c=>c.word), ...mnemonic.filter(w => !confirmWords.some(c=>c.word===w)).slice(0,6)]
    .sort(() => Math.random()-0.5);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={typography.h2}>Confirm your backup</Text>
      <Text style={[typography.body, { color:colors.textSecondary, marginTop:8, marginBottom:24 }]}>
        Tap the words in order: {confirmWords.map(c => `#${c.idx+1}`).join(', ')}
      </Text>

      <View style={styles.selectedRow}>
        {confirmWords.map((_, i) => (
          <View key={i} style={styles.selectedSlot}>
            <Text style={styles.selectedText}>{selectedWords[i] ?? '___'}</Text>
          </View>
        ))}
      </View>

      <View style={styles.optionsGrid}>
        {shuffledOptions.map((word, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.optionChip, selectedWords.includes(word) && styles.optionChipUsed]}
            disabled={selectedWords.includes(word)}
            onPress={() => setSelectedWords([...selectedWords, word])}
          >
            <Text style={[styles.optionText, selectedWords.includes(word) && { color:colors.textTertiary }]}>{word}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flex:1 }} />
      <TouchableOpacity onPress={() => setSelectedWords([])} style={{ alignSelf:'center', marginBottom:12 }}>
        <Text style={{ color: colors.teal, ...typography.sm }}>Reset</Text>
      </TouchableOpacity>
      <Button label="Confirm" onPress={handleConfirmComplete} disabled={selectedWords.length !== confirmWords.length} />
    </SafeAreaView>
  );
}

function ImportInput({ value, onChange }: { value:string; onChange:(v:string)=>void }) {
  const { TextInput } = require('react-native');
  return (
    <View style={{ marginTop:16 }}>
      <TextInput
        style={styles.textArea}
        value={value}
        onChangeText={onChange}
        placeholder="Enter your recovery phrase..."
        placeholderTextColor={colors.textTertiary}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { flex:1, backgroundColor:colors.bg, padding:spacing.xl },
  center:        { flex:1, alignItems:'center', justifyContent:'center' },
  iconCircle:    { width:72, height:72, borderRadius:36, backgroundColor:colors.tealBg2,
                   borderWidth:1, borderColor:colors.tealBorder, alignItems:'center', justifyContent:'center', marginBottom:spacing.xl },
  subtitle:      { color:colors.textSecondary, textAlign:'center', marginTop:spacing.md, lineHeight:22, paddingHorizontal:spacing.md },
  actions:       { paddingBottom:spacing.lg },
  backBtn:       { width:40, height:40, alignItems:'center', justifyContent:'center',
                   backgroundColor:colors.surface, borderRadius:20, borderWidth:1, borderColor:colors.border, marginBottom:spacing.lg },
  importInput:   { display:'none' },
  textArea:      { backgroundColor:colors.surface, borderRadius:radius.lg, borderWidth:1, borderColor:colors.border,
                   padding:spacing.md, color:colors.text, ...typography.body, minHeight:120, textAlignVertical:'top' },
  warningBox:    { flexDirection:'row', gap:spacing.sm, backgroundColor:colors.warningBg, padding:spacing.md,
                   borderRadius:radius.lg, marginBottom:spacing.lg, alignItems:'flex-start' },
  warningText:   { ...typography.sm, color:colors.warning, flex:1, lineHeight:20 },
  mnemonicGrid:  { flexDirection:'row', flexWrap:'wrap', gap:spacing.sm },
  mnemonicChip:  { flexDirection:'row', alignItems:'center', gap:6, backgroundColor:colors.surface,
                   borderRadius:radius.md, borderWidth:1, borderColor:colors.border,
                   paddingVertical:10, paddingHorizontal:12, width:'31%' },
  mnemonicIndex: { ...typography.xs, color:colors.textTertiary, width:16 },
  mnemonicWord:  { ...typography.sm, color:colors.text, fontWeight:'600' },
  copyBtn:       { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:6, marginTop:spacing.lg, padding:spacing.sm },
  copyText:      { color:colors.teal, ...typography.sm, fontWeight:'600' },
  selectedRow:   { flexDirection:'row', gap:spacing.sm, marginBottom:spacing.xl },
  selectedSlot:  { flex:1, height:48, borderRadius:radius.md, borderWidth:1.5, borderColor:colors.tealBorder,
                   backgroundColor:colors.tealBg, alignItems:'center', justifyContent:'center' },
  selectedText:  { ...typography.sm, color:colors.teal, fontWeight:'700' },
  optionsGrid:   { flexDirection:'row', flexWrap:'wrap', gap:spacing.sm },
  optionChip:    { backgroundColor:colors.surface, borderWidth:1, borderColor:colors.border,
                   borderRadius:radius.md, paddingVertical:10, paddingHorizontal:16 },
  optionChipUsed:{ opacity:0.3 },
  optionText:    { ...typography.sm, color:colors.text, fontWeight:'600' },
});
