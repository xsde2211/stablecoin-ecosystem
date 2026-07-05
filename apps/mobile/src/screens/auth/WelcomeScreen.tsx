import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../../components/ui/Button';
import { colors, typography, spacing, radius } from '../../theme';

export default function WelcomeScreen() {
  const navigation = useNavigation<any>();

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.tealBg2, 'transparent']} style={styles.glow} />
      <SafeAreaView style={styles.content} edges={['bottom']}>
        <View style={styles.brandSection}>
          <View style={styles.logoWrap}>
            <Text style={styles.logoText}>e₹</Text>
          </View>
          <Text style={styles.brandName}>e-Rupee Ecosystem</Text>
          <Text style={styles.tagline}>Digital INR, Gold & Silver{'\n'}on your terms — across every chain</Text>
        </View>

        <View style={styles.features}>
          <FeatureRow icon="₹"  title="INRX" subtitle="1 INRX = 1 Indian Rupee, fully reserve-backed" color={colors.teal} />
          <FeatureRow icon="Au" title="eGold" subtitle="1 eGold = 1 gram of physical gold" color={colors.gold} />
          <FeatureRow icon="Ag" title="eSilver" subtitle="1 eSilver = 1 gram of physical silver" color={colors.silver} />
        </View>

        <View style={styles.actions}>
          <Button label="Create Account" onPress={() => navigation.navigate('Register')} />
          <View style={{ height: spacing.md }} />
          <Button label="I already have an account" variant="ghost" onPress={() => navigation.navigate('Login')} />
        </View>
      </SafeAreaView>
    </View>
  );
}

function FeatureRow({ icon, title, subtitle, color }: any) {
  return (
    <View style={styles.featureRow}>
      <View style={[styles.featureIcon, { backgroundColor: color + '15', borderColor: color + '30' }]}>
        <Text style={{ color, fontWeight: '700' as const, fontSize: 16 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg },
  glow:         { position: 'absolute', top: 0, left: 0, right: 0, height: 400 },
  content:      { flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'space-between', paddingVertical: spacing.xl },
  brandSection: { alignItems: 'center', marginTop: spacing.xl },
  logoWrap: {
    width: 88, height: 88, borderRadius: radius.xxl,
    backgroundColor: colors.tealBg2, borderWidth: 1.5, borderColor: colors.tealBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl,
  },
  logoText:     { fontSize: 36, fontWeight: '700' as const, color: colors.teal },
  brandName:    { ...typography.h1, fontSize: 28, color: colors.text, marginBottom: spacing.sm, textAlign: 'center' },
  tagline:      { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  features:     { gap: spacing.lg },
  featureRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  featureIcon:  { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  featureTitle: { ...typography.h5, color: colors.text },
  featureSubtitle: { ...typography.xs, color: colors.textTertiary, marginTop: 2 },
  actions:      { paddingBottom: spacing.sm },
});
