import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useDispatch } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { Input }  from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { colors, typography, spacing } from '../../theme';
import { registerUser } from '../../store/slices/authSlice';
import type { AppDispatch } from '../../store';

export default function RegisterScreen() {
  const navigation = useNavigation<any>();
  const dispatch   = useDispatch<AppDispatch>();

  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const passwordRules = [
    { label: '8+ characters',     ok: password.length >= 8 },
    { label: 'Upper & lowercase', ok: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { label: 'Number',            ok: /\d/.test(password) },
    { label: 'Special character', ok: /[@$!%*?&]/.test(password) },
  ];

  const handleRegister = async () => {
    setError('');
    if (!fullName || !email || !password) { setError('Please fill in required fields'); return; }
    if (!passwordRules.every(r => r.ok)) { setError('Password does not meet requirements'); return; }
    setLoading(true);
    try {
      await dispatch(registerUser({ fullName, email, phone: phone || undefined, password })).unwrap();
    } catch (err: any) {
      setError(err?.message || 'Registration failed');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{top:8,bottom:8,left:8,right:8}}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={[typography.h1,{color: colors.text}]}>Create account</Text>
            <Text style={[typography.body, { color: colors.textSecondary, marginTop: 8 }]}>
              Your wallet will be generated automatically
            </Text>
          </View>

          <View>
            <Input label="Full name" placeholder="Rahul Sharma" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
            <Input label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <Input label="Phone (optional)" placeholder="+919876543210" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Input
              label="Password" placeholder="••••••••" value={password} onChangeText={setPassword} secureTextEntry={!showPassword}
              rightIcon={
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textTertiary} />
                </TouchableOpacity>
              }
            />
            {password.length > 0 && (
              <View style={styles.rules}>
                {passwordRules.map(r => (
                  <View key={r.label} style={styles.ruleRow}>
                    <Ionicons name={r.ok ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={r.ok ? colors.success : colors.textTertiary} />
                    <Text style={[styles.ruleText, r.ok && { color: colors.success }]}>{r.label}</Text>
                  </View>
                ))}
              </View>
            )}
            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            <View style={{ height: spacing.md }} />
            <Button label="Create Account" onPress={handleRegister} loading={loading} />
            <Text style={styles.terms}>By continuing you agree to our Terms of Service and Privacy Policy</Text>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')} hitSlop={{top:8,bottom:8,left:8,right:8}}>
              <Text style={styles.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bg },
  flex:       { flex: 1 },
  scroll:     { flexGrow: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  backBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    marginTop: spacing.sm, marginBottom: spacing.xl,
  },
  header:   { marginBottom: spacing.xxl },
  rules:    { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md, marginTop: -4 },
  ruleRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ruleText: { ...typography.xs, color: colors.textTertiary },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg,
    padding: spacing.md, borderRadius: 12, marginBottom: spacing.md,
  },
  errorText: { ...typography.sm, color: colors.error, flex: 1 },
  terms:     { ...typography.xs, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.lg, lineHeight: 16 },
  footer:    { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xxl, alignItems: 'center' },
  footerText:{ ...typography.sm, color: colors.textSecondary },
  footerLink:{ ...typography.sm, color: colors.teal, fontWeight: '700' as const },
});
