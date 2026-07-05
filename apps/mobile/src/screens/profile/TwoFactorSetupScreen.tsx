import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  Alert, TouchableOpacity, TextInput, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons }   from '@expo/vector-icons';
import QRCode         from 'react-native-qrcode-svg';
import { Header }     from '../../components/ui/Header';
import { Button }     from '../../components/ui/Button';
import { Card }       from '../../components/ui/Card';
import { colors, typography, spacing, radius, shadow } from '../../theme';
import { api } from '../../services/api';

type Step = 'intro' | 'setup' | 'verify' | 'done';

// Footer height: button 54px + paddingTop 12 + paddingBottom dynamic
const FOOTER_BTN_AREA = 54 + 12; // button height + top padding

export default function TwoFactorSetupScreen() {
  const insets = useSafeAreaInsets();
  // How much space the absolute footer occupies at the bottom
  // = button + top padding + bottom safe area (home bar)
  const footerHeight = FOOTER_BTN_AREA + insets.bottom + 8;
  // Extra height for steps with two buttons
  const footerHeightDouble = FOOTER_BTN_AREA + 54 + spacing.sm + insets.bottom + 8;

  const [step,    setStep]    = useState<Step>('intro');
  const [otpUri,  setOtpUri]  = useState('');
  const [secret,  setSecret]  = useState('');
  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);

  const handleSetup = async () => {
    setLoading(true);
    try {
      const res = await api.setup2FA();
      setOtpUri(res.otpauthUrl ?? res.qrUri ?? res.qrUrl ?? '');
      setSecret(res.secret ?? '');
      setStep('setup');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Could not generate 2FA setup.');
    } finally { setLoading(false); }
  };

  const copySecret = async () => {
    await Clipboard.setStringAsync(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVerify = async () => {
    if (code.replace(/\D/g, '').length !== 6) {
      Alert.alert('Invalid code', 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    try {
      await api.verify2FA({ token: code.replace(/\D/g, '') });
      setStep('done');
    } catch {
      Alert.alert('Wrong code', 'Incorrect or expired — wait for the next 30-second code and try again.');
    } finally { setLoading(false); }
  };

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <SafeAreaView style={styles.flex} edges={[]}>
        <Header title="Two-Factor Auth" />
        <View style={styles.flex}>
          <View style={styles.centerFill}>
            <View style={[styles.bigIcon, { backgroundColor: colors.successBg, borderColor: colors.success + '50' }]}>
              <Ionicons name="shield-checkmark" size={44} color={colors.success} />
            </View>
            <Text style={styles.heading}>2FA Enabled!</Text>
            <Text style={styles.bodyText}>
              Your wallet is now protected. Every login requires a 6-digit code from your authenticator app.
            </Text>
          </View>
          {/* Absolute footer — always visible regardless of content */}
          <View style={[styles.footer, { bottom: insets.bottom + 8 }]}>
            <Button label="Done" onPress={() => setStep('intro')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── VERIFY ────────────────────────────────────────────────────────────────
  if (step === 'verify') {
    return (
      <SafeAreaView style={styles.flex} edges={[]}>
        <Header title="Enter Code" />
        <View style={styles.flex}>
          <ScrollView
            contentContainerStyle={[styles.scrollPad, { paddingBottom: footerHeightDouble + spacing.xl }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.bigIcon, { backgroundColor: colors.tealBg2, borderColor: colors.tealBorder }]}>
              <Ionicons name="keypad-outline" size={36} color={colors.teal} />
            </View>
            <Text style={styles.heading}>Enter the 6-digit code</Text>
            <Text style={styles.bodyText}>
              Open your authenticator app and type the code shown for{' '}
              <Text style={{ color: colors.text, fontWeight: '700' as const }}>Stablecoin Ecosystem</Text>.
            </Text>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={colors.textTertiary}
              textAlign="center"
              autoFocus
            />
            <Text style={styles.codeHint}>Codes change every 30 seconds</Text>
          </ScrollView>
          <View style={[styles.footer, { bottom: insets.bottom + 8 }]}>
            <Button
              label="Verify & Enable 2FA"
              onPress={handleVerify}
              loading={loading}
              disabled={code.replace(/\D/g, '').length !== 6}
            />
            <View style={{ height: spacing.sm }} />
            <Button label="Back" variant="ghost" onPress={() => setStep('setup')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── SETUP — QR ───────────────────────────────────────────────────────────
  if (step === 'setup') {
    return (
      <SafeAreaView style={styles.flex} edges={[]}>
        <Header title="Scan QR Code" />
        <View style={styles.flex}>
          <ScrollView
            contentContainerStyle={[styles.scrollPad, { paddingBottom: footerHeight + spacing.xl }]}
            showsVerticalScrollIndicator={false}
          >
            <StepRow n={1} title="Install an authenticator app"
              desc="Download Google Authenticator or Authy — free on Android & iOS." />
            <StepRow n={2} title="Scan this QR code"
              desc={'Open the app → tap "+" → "Scan QR code" → point at the code below.'} />

            <Card style={styles.qrCard}>
              {otpUri ? (
                <View style={styles.qrWrap}>
                  <QRCode value={otpUri} size={200} backgroundColor="#FFFFFF" color="#000000" />
                </View>
              ) : (
                <View style={styles.qrFallback}>
                  <Ionicons name="qr-code-outline" size={40} color={colors.textTertiary} />
                  <Text style={styles.qrFallbackText}>Use the manual key below</Text>
                </View>
              )}
            </Card>

            <StepRow n={3} title="Can't scan? Enter manually"
              desc={'In the app → "Enter a setup key" → paste the key below.'} />

            {secret ? (
              <TouchableOpacity style={styles.secretBox} onPress={copySecret} activeOpacity={0.7}>
                <Text style={styles.secretText}>{secret}</Text>
                <View style={styles.secretRow}>
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={13}
                    color={copied ? colors.success : colors.teal}
                  />
                  <Text style={[styles.secretCopy, copied && { color: colors.success }]}>
                    {copied ? 'Copied!' : 'Tap to copy key'}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null}

          </ScrollView>

          <View style={[styles.footer, { bottom: insets.bottom + 65 }]}>
            <Button label="Continue — I can see the code" onPress={() => setStep('verify')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── INTRO ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.flex} edges={[]}>
      <Header title="Two-Factor Auth" />
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.scrollPad, { paddingBottom: footerHeight + spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.bigIcon, { backgroundColor: colors.tealBg2, borderColor: colors.tealBorder }]}>
            <Ionicons name="shield-outline" size={44} color={colors.teal} />
          </View>
          <Text style={styles.heading}>Protect your wallet</Text>
          <Text style={styles.bodyText}>
            2FA adds a second lock. Even if someone steals your password, they cannot access your wallet without your phone.
          </Text>
          {[
            { icon: 'lock-closed-outline',    t: 'Blocks access even with stolen password' },
            { icon: 'phone-portrait-outline', t: 'Uses your phone — no SMS, no SIM-swap risk' },
            { icon: 'time-outline',           t: '6-digit codes expire every 30 seconds' },
            { icon: 'apps-outline',           t: 'Works with Google Authenticator, Authy & more' },
          ].map(b => (
            <View key={b.t} style={styles.benefitRow}>
              <View style={styles.benefitIcon}>
                <Ionicons name={b.icon as any} size={18} color={colors.teal} />
              </View>
              <Text style={styles.benefitText}>{b.t}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Absolute footer — always visible, floats above tab bar */}
        <View style={[styles.footer, { bottom: insets.bottom + 75 }]}>
          <Button label="Enable Two-Factor Auth" onPress={handleSetup} loading={loading} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function StepRow({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <View style={st.row}>
      <View style={st.num}><Text style={st.numTxt}>{n}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={st.title}>{title}</Text>
        <Text style={st.desc}>{desc}</Text>
      </View>
    </View>
  );
}
const st = StyleSheet.create({
  row:    { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl, alignItems: 'flex-start' },
  num:    { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  numTxt: { fontSize: 13, fontWeight: '700' as const, color: '#000' },
  title:  { ...typography.h5, color: colors.text, marginBottom: 4 },
  desc:   { ...typography.sm, color: colors.textSecondary, lineHeight: 20 },
});

const styles = StyleSheet.create({
  flex:       { flex: 1, backgroundColor: colors.bg },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  scrollPad:  { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, alignItems: 'center' },

  // Absolute footer floats above everything — guaranteed visible
  footer: {
    position:          'absolute',
    left:              spacing.xl,
    right:             spacing.xl,
    backgroundColor:   colors.bg,
    paddingTop:        spacing.md,
    borderTopWidth:    1,
    borderTopColor:    colors.border,
  },

  bigIcon: {
    width: 80, height: 80, borderRadius: 40, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl,
  },
  heading:  { ...typography.h2, color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  bodyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: spacing.xl },

  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md, width: '100%' },
  benefitIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.tealBg, borderWidth: 1, borderColor: colors.tealBorder,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  benefitText: { ...typography.sm, color: colors.textSecondary, flex: 1, lineHeight: 20, paddingTop: 9 },

  qrCard:        { alignItems: 'center', padding: spacing.xl, width: '100%', marginBottom: spacing.lg },
  qrWrap:        { padding: spacing.md, backgroundColor: '#FFF', borderRadius: radius.lg, ...shadow.md },
  qrFallback:    { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHigh, borderRadius: radius.lg },
  qrFallbackText:{ ...typography.xs, color: colors.textTertiary, marginTop: 8, textAlign: 'center' },

  secretBox:  { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg, width: '100%' },
  secretText: { ...typography.mono, color: colors.text, fontSize: 13, letterSpacing: 2, textAlign: 'center' },
  secretRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  secretCopy: { ...typography.xs, color: colors.teal, fontWeight: '600' as const },

  infoBox:  { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.infoBg, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.info + '30', width: '100%' },
  infoText: { ...typography.xs, color: colors.info, flex: 1, lineHeight: 18 },

  codeInput: {
    backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 2, borderColor: colors.tealBorder,
    color: colors.text, fontSize: 36, fontWeight: '700' as const, letterSpacing: 12,
    paddingVertical: spacing.lg, width: '100%', marginBottom: spacing.sm,
  },
  codeHint: { ...typography.xs, color: colors.textTertiary, textAlign: 'center' },
});