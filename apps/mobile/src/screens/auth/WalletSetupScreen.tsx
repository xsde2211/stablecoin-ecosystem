import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, TextInput, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDispatch } from 'react-redux';
import * as Clipboard from 'expo-clipboard';
import { Button } from '../../components/ui/Button';
import { Card }   from '../../components/ui/Card';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';
import { setWalletReady } from '../../store/slices/walletSlice';
import type { AppDispatch } from '../../store';

const FOOTER_EXTRA = Platform.OS === 'ios' ? 16 : 8;

// Shared back button — used by every sub-step so navigation feels consistent
function BackBtn({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Ionicons name="chevron-back" size={24} color={colors.text} />
    </TouchableOpacity>
  );
}

// Lightweight "step X of 2" indicator for the create → confirm sub-flow,
// so it reads as one guided journey rather than two disconnected screens
function StepDots({ active }: { active: 1 | 2 }) {
  return (
    <View style={styles.stepDotsRow}>
      <View style={[styles.stepDot, active >= 1 && styles.stepDotActive]} />
      <View style={styles.stepDotLine} />
      <View style={[styles.stepDot, active >= 2 && styles.stepDotActive]} />
    </View>
  );
}

export default function WalletSetupScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const insets = useSafeAreaInsets();
  const footerPb = insets.bottom + FOOTER_EXTRA;

  const [step, setStep]       = useState<'choice' | 'create' | 'import' | 'confirm'>('choice');
  const [mnemonic, setMnemonic] = useState<string[]>([]);
  const [importPhrase, setImportPhrase] = useState('');
  const [confirmWords, setConfirmWords] = useState<{ idx: number; word: string }[]>([]);
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await api.createWallet();
      const words = res.mnemonic.split(' ');
      setMnemonic(words);
      const indices = [...Array(words.length).keys()].sort(() => Math.random() - 0.5).slice(0, 3).sort((a, b) => a - b);
      setConfirmWords(indices.map(idx => ({ idx, word: words[idx] })));
      setStep('create');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to create wallet');
    } finally { setLoading(false); }
  };

  const handleImport = async () => {
    const words = importPhrase.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      Alert.alert('Invalid phrase', 'Seed phrase must be 12 or 24 words'); return;
    }
    setLoading(true);
    try {
      await api.importWallet({ mnemonic: importPhrase.trim() });
      dispatch(setWalletReady(true));
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to import wallet');
    } finally { setLoading(false); }
  };

  const handleConfirmComplete = () => {
    const correct = confirmWords.every((cw, i) => selectedWords[i] === cw.word);
    if (!correct) { Alert.alert('Not quite right', 'Please tap the words in the order shown on your backup.'); return; }
    dispatch(setWalletReady(true));
  };

  const copyMnemonic = async () => {
    await Clipboard.setStringAsync(mnemonic.join(' '));
    Alert.alert('Copied', 'Recovery phrase copied to clipboard');
  };

  // Wallet creation already happened server-side by the time the phrase is
  // showing, so leaving this step isn't a true "cancel" — warn so it's a
  // deliberate choice rather than an accidental tap.
  const handleBackFromCreate = () => {
    Alert.alert(
      'Leave without saving?',
      'Your wallet has already been created. If you leave now without saving your recovery phrase, you could lose access to your funds later.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave anyway', style: 'destructive', onPress: () => { setRevealed(false); setStep('choice'); } },
      ]
    );
  };

  const handleBackFromConfirm = () => {
    setSelectedWords([]);
    setStep('create');
  };

  // ── Choice ────────────────────────────────────────────────────────────────
  if (step === 'choice') {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.centerScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.iconCircle}>
              <Ionicons name="wallet-outline" size={36} color={colors.teal} />
            </View>
            <Text style={[typography.h2,{color: colors.text}]}>Set up your wallet</Text>
            <Text style={styles.subtitle}>
              Your wallet holds INRX, eGold & eSilver across TRON, Ethereum, BSC, Polygon and Solana — all from one seed phrase.
            </Text>
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: footerPb + 25 }]}>
            <Button
              label="Create New Wallet" onPress={handleCreate} loading={loading}
              icon={<Ionicons name="add-circle" size={18} color="#000" />}
            />
            <View style={{ height: spacing.md }} />
            <Button label="Import Existing Wallet" variant="secondary" onPress={() => setStep('import')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Import ────────────────────────────────────────────────────────────────
  if (step === 'import') {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <BackBtn onPress={() => setStep('choice')} />

            <Text style={typography.h2}>Import wallet</Text>
            <Text style={[typography.body, { color: colors.textSecondary, marginTop: 8, marginBottom: 24 }]}>
              Enter your 12 or 24-word recovery phrase, separated by spaces.
            </Text>

            <TextInput
              style={styles.textArea}
              value={importPhrase}
              onChangeText={setImportPhrase}
              placeholder="Enter your recovery phrase..."
              placeholderTextColor={colors.textTertiary}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: footerPb }]}>
            <Button label="Import Wallet" onPress={handleImport} loading={loading} disabled={!importPhrase.trim()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Create — reveal mnemonic ──────────────────────────────────────────────
  if (step === 'create') {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.stepHeaderRow}>
              <BackBtn onPress={handleBackFromCreate} />
              <StepDots active={1} />
            </View>

            <Text style={typography.h2}>Save your recovery phrase</Text>

            <View style={styles.warningBox}>
              <Ionicons name="warning" size={20} color={colors.warning} />
              <Text style={styles.warningText}>
                Write these words down and store them safely. Anyone with this phrase can access your funds. This is shown only once.
              </Text>
            </View>

            {!revealed ? (
              <Card style={{ alignItems: 'center', paddingVertical: 48 }}>
                <Ionicons name="eye-off-outline" size={32} color={colors.textTertiary} style={{ marginBottom: 12 }} />
                <Text style={{ ...typography.body, color: colors.textSecondary, marginBottom: 20, textAlign: 'center' }}>
                  Tap to reveal your recovery phrase
                </Text>
                <Button label="Reveal Phrase" variant="secondary" onPress={() => setRevealed(true)} fullWidth={false} />
              </Card>
            ) : (
              <View style={styles.mnemonicGrid}>
                {mnemonic.map((word, i) => (
                  <View key={i} style={styles.mnemonicChip}>
                    <Text style={styles.mnemonicIndex}>{i + 1}</Text>
                    <Text style={styles.mnemonicWord}>{word}</Text>
                  </View>
                ))}
              </View>
            )}

            {revealed && (
              <TouchableOpacity style={styles.copyBtn} onPress={copyMnemonic} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                <Ionicons name="copy-outline" size={16} color={colors.teal} />
                <Text style={styles.copyText}>Copy to clipboard</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: footerPb }]}>
            <Button label="I've saved my phrase" onPress={() => setStep('confirm')} disabled={!revealed} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  const shuffledOptions = [
    ...confirmWords.map(c => c.word),
    ...mnemonic.filter(w => !confirmWords.some(c => c.word === w)).slice(0, 6),
  ].sort(() => Math.random() - 0.5);

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.stepHeaderRow}>
            <BackBtn onPress={handleBackFromConfirm} />
            <StepDots active={2} />
          </View>

          <Text style={typography.h2}>Confirm your backup</Text>
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: 8, marginBottom: 24 }]}>
            Tap the words in order: {confirmWords.map(c => `#${c.idx + 1}`).join(', ')}
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
                activeOpacity={0.7}
              >
                <Text style={[styles.optionText, selectedWords.includes(word) && { color: colors.textTertiary }]}>{word}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={() => setSelectedWords([])} style={styles.resetBtn} hitSlop={{top:8,bottom:8,left:8,right:8}}>
            <Text style={{ color: colors.teal, ...typography.sm }}>Reset</Text>
          </TouchableOpacity>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: footerPb }]}>
          <Button label="Confirm" onPress={handleConfirmComplete} disabled={selectedWords.length !== confirmWords.length} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  centerScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  footer:  { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.tealBg2,
    borderWidth: 1, borderColor: colors.tealBorder, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl,
  },
  subtitle: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md, lineHeight: 22, paddingHorizontal: spacing.md },
  backBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
  },
  // Row that holds back button + step dots together for the create/confirm sub-flow
  stepHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  stepDotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border,
  },
  stepDotActive: { backgroundColor: colors.teal, width: 20 },
  stepDotLine: { width: 16, height: 1.5, backgroundColor: colors.border },
  textArea: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, color: colors.text, ...typography.body, minHeight: 120, textAlignVertical: 'top' as const,
  },
  warningBox: {
    flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningBg, padding: spacing.md,
    borderRadius: radius.lg, marginTop: spacing.md, marginBottom: spacing.lg, alignItems: 'flex-start',
  },
  warningText: { ...typography.sm, color: colors.warning, flex: 1, lineHeight: 20 },
  mnemonicGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  mnemonicChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 10, paddingHorizontal: 12, width: '31%' as any,
  },
  mnemonicIndex: { ...typography.xs, color: colors.textTertiary, width: 16 },
  mnemonicWord:  { ...typography.sm, color: colors.text, fontWeight: '600' as const },
  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.lg, padding: spacing.sm },
  copyText:{ color: colors.teal, ...typography.sm, fontWeight: '600' as const },
  selectedRow:  { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  selectedSlot: {
    flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.tealBorder,
    backgroundColor: colors.tealBg, alignItems: 'center', justifyContent: 'center',
  },
  selectedText: { ...typography.sm, color: colors.teal, fontWeight: '700' as const },
  optionsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionChip: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 16,
  },
  optionChipUsed: { opacity: 0.3 },
  optionText: { ...typography.sm, color: colors.text, fontWeight: '600' as const },
  resetBtn:   { alignSelf: 'center', marginTop: spacing.lg, padding: spacing.sm },
});