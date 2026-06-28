import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView,
  Alert, TouchableOpacity, TextInput, Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons }   from '@expo/vector-icons';
import QRCode         from 'react-native-qrcode-svg';
import { Header }     from '../../components/ui/Header';
import { Button }     from '../../components/ui/Button';
import { Card }       from '../../components/ui/Card';
import { colors, typography, spacing, radius, shadow } from '../../theme';
import { api }        from '../../services/api';

type Step = 'intro' | 'setup' | 'verify' | 'done';

export default function TwoFactorSetupScreen() {
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
      const uri = res.otpauthUrl ?? res.qrUri ?? res.qrUrl ?? '';
      setOtpUri(uri);
      setSecret(res.secret ?? '');
      setStep('setup');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Could not generate 2FA setup. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const copySecret = async () => {
    await Clipboard.setStringAsync(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVerify = async () => {
    const clean = code.replace(/\D/g, '').slice(0, 6);
    if (clean.length !== 6) { Alert.alert('Invalid code', 'Enter the 6-digit code from your authenticator app.'); return; }
    setLoading(true);
    try {
      await api.verify2FA({ token: clean });
      setStep('done');
    } catch {
      Alert.alert('Wrong code', 'Incorrect or expired — wait for the next 30-second code and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'done') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Two-Factor Auth" />
        <View style={styles.centerFill}>
          <View style={[styles.bigIcon, { backgroundColor: colors.successBg, borderColor: colors.success + '50' }]}>
            <Ionicons name="shield-checkmark" size={44} color={colors.success} />
          </View>
          <Text style={styles.heading}>2FA Enabled!</Text>
          <Text style={styles.desc}>
            Your wallet is now protected by two-factor authentication. Every login will require a 6-digit code from your authenticator app.
          </Text>
        </View>
        <View style={styles.footer}><Button label="Done" onPress={() => setStep('intro')} /></View>
      </SafeAreaView>
    );
  }

  if (step === 'verify') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Enter Code" />
        <View style={styles.content}>
          <View style={[styles.bigIcon, { backgroundColor: colors.tealBg2, borderColor: colors.tealBorder }]}>
            <Ionicons name="keypad-outline" size={36} color={colors.teal} />
          </View>
          <Text style={styles.heading}>Enter the 6-digit code</Text>
          <Text style={styles.desc}>
            Open your authenticator app and type the current code shown for{' '}
            <Text style={{ color: colors.text, fontWeight: '700' as const }}>Stablecoin Ecosystem</Text>.
            Codes refresh every 30 seconds.
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
        </View>
        <View style={styles.footer}>
          <Button label="Verify & Enable 2FA" onPress={handleVerify} loading={loading} disabled={code.length !== 6} />
          <View style={{ height: spacing.sm }} />
          <Button label="Back" variant="ghost" onPress={() => setStep('setup')} />
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'setup') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Scan QR Code" />
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <StepRow num={1} title="Install an authenticator app" desc="Download Google Authenticator or Authy — free on Android & iOS." />
          <StepRow num={2} title="Scan this QR code" desc='Open the app → tap "+" → tap "Scan QR code" → point your camera here.' />
          <Card style={styles.qrCard}>
            {otpUri ? (
              <View style={styles.qrWrap}>
                <QRCode value={otpUri} size={200} backgroundColor="#FFFFFF" color="#000000" />
              </View>
            ) : (
              <View style={styles.qrFallback}>
                <Ionicons name="qr-code-outline" size={40} color={colors.textTertiary} />
                <Text style={{ ...typography.xs, color: colors.textTertiary, marginTop: 8, textAlign: 'center' }}>
                  QR not available — use the manual key below
                </Text>
              </View>
            )}
          </Card>
          <StepRow num={3} title="Can't scan? Enter manually" desc={`In the app: tap "Enter a setup key" → paste:\n${secret}`} />
          {secret ? (
            <TouchableOpacity style={styles.secretBox} onPress={copySecret} activeOpacity={0.7}>
              <Text style={styles.secretText}>{secret}</Text>
              <View style={styles.secretCopyRow}>
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={copied ? colors.success : colors.teal} />
                <Text style={[styles.secretCopyText, copied && { color: colors.success }]}>
                  {copied ? 'Copied!' : 'Tap to copy secret key'}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.info} />
            <Text style={styles.infoText}>
              After scanning or entering the key, your app shows a 6-digit code. Tap "Continue" and enter that code to finish.
            </Text>
          </View>
          <View style={{ height: 120 }} />
        </ScrollView>
        <View style={styles.footer}>
          <Button label="Continue — I can see the code" onPress={() => setStep('verify')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Two-Factor Auth" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.bigIcon, { backgroundColor: colors.tealBg2, borderColor: colors.tealBorder }]}>
          <Ionicons name="shield-outline" size={44} color={colors.teal} />
        </View>
        <Text style={styles.heading}>Protect your wallet</Text>
        <Text style={styles.desc}>
          2FA adds a second lock to your account. Even if someone steals your password, they cannot log in without your phone.
        </Text>
        {[
          { icon: 'lock-closed-outline',    text: 'Blocks access even with stolen password' },
          { icon: 'phone-portrait-outline', text: 'Uses your phone — no SMS, no SIM-swap risk' },
          { icon: 'time-outline',           text: '6-digit codes expire every 30 seconds' },
          { icon: 'apps-outline',           text: 'Works with Google Authenticator, Authy & more' },
        ].map(b => (
          <View key={b.text} style={styles.benefitRow}>
            <View style={styles.benefitIcon}>
              <Ionicons name={b.icon as any} size={18} color={colors.teal} />
            </View>
            <Text style={styles.benefitText}>{b.text}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <Button label="Enable Two-Factor Auth" onPress={handleSetup} loading={loading} />
      </View>
    </SafeAreaView>
  );
}

function StepRow({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <View style={sStyles.row}>
      <View style={sStyles.num}><Text style={sStyles.numText}>{num}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={sStyles.title}>{title}</Text>
        <Text style={sStyles.desc}>{desc}</Text>
      </View>
    </View>
  );
}
const sStyles = StyleSheet.create({
  row:     { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg, alignItems: 'flex-start' },
  num:     { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  numText: { ...typography.sm, color: '#000', fontWeight: '700' as const },
  title:   { ...typography.h5, color: colors.text, marginBottom: 4 },
  desc:    { ...typography.sm, color: colors.textSecondary, lineHeight: 20 },
});

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg },
  content:      { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, alignItems: 'center' },
  centerFill:   { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  scrollContent:{ paddingHorizontal: spacing.xl, paddingTop: spacing.xl, alignItems: 'center', flexGrow: 1 },
  footer:       { padding: spacing.xl, paddingBottom: Platform.OS === 'ios' ? 36 : spacing.xl },
  bigIcon: {
    width: 80, height: 80, borderRadius: 40, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl,
  },
  heading: { ...typography.h2, color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  desc:    { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: spacing.lg },
  benefitRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md, width: '100%' },
  benefitIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.tealBg, borderWidth: 1, borderColor: colors.tealBorder, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  benefitText: { ...typography.sm, color: colors.textSecondary, flex: 1, lineHeight: 20, paddingTop: 9 },
  qrCard:      { alignItems: 'center', padding: spacing.xl, width: '100%' },
  qrWrap:      { padding: spacing.md, backgroundColor: '#FFFFFF', borderRadius: radius.lg, ...shadow.md },
  qrFallback:  { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHigh, borderRadius: radius.lg },
  secretBox:   { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, width: '100%' },
  secretText:  { ...typography.mono, color: colors.text, fontSize: 13, letterSpacing: 2, textAlign: 'center' },
  secretCopyRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  secretCopyText: { ...typography.xs, color: colors.teal, fontWeight: '600' as const },
  infoBox:   { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.infoBg, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.info + '30', width: '100%' },
  infoText:  { ...typography.xs, color: colors.info, flex: 1, lineHeight: 18 },
  codeInput: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 2, borderColor: colors.tealBorder, color: colors.text, fontSize: 36, fontWeight: '700' as const, letterSpacing: 12, paddingVertical: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.sm, width: '100%' },
  codeHint:  { ...typography.xs, color: colors.textTertiary, textAlign: 'center' },
});
