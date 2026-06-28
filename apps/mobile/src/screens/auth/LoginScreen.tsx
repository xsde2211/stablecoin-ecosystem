import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, TouchableOpacity, SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDispatch } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { Input }  from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { colors, typography, spacing } from '../../theme';
import { loginUser } from '../../store/slices/authSlice';
import type { AppDispatch } from '../../store';

export default function LoginScreen() {
  const navigation = useNavigation<any>();
  const dispatch   = useDispatch<AppDispatch>();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleLogin = async () => {
    setError('');
    if (!email || !password) { setError('Please fill in all fields'); return; }

    setLoading(true);
    try {
      const result = await dispatch(loginUser({ email, password, totpCode: totpCode || undefined })).unwrap();
      // success — navigation handled by RootNavigator listening to auth state
    } catch (err: any) {
      const msg = err?.message || 'Login failed';
      if (msg.toLowerCase().includes('2fa')) {
        setNeeds2FA(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS==='ios'?'padding':undefined}>
      <SafeAreaView style={{ flex:1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={typography.h1}>Welcome back</Text>
            <Text style={[typography.body, { color: colors.textSecondary, marginTop:8 }]}>
              Sign in to access your wallet
            </Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Input
              label="Password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              rightIcon={
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textTertiary} />
                </TouchableOpacity>
              }
            />

            {needs2FA && (
              <Input
                label="2FA Code"
                placeholder="6-digit code from your authenticator"
                value={totpCode}
                onChangeText={setTotpCode}
                keyboardType="number-pad"
                maxLength={6}
              />
            )}

            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={{ height: spacing.sm }} />
            <Button label="Sign In" onPress={handleLogin} loading={loading} />

            <TouchableOpacity style={styles.forgotBtn}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Register')}>
              <Text style={styles.footerLink}>Sign up</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:  { flex:1, backgroundColor: colors.bg },
  scroll:     { flexGrow:1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  backBtn:    { width:40, height:40, alignItems:'center', justifyContent:'center',
                backgroundColor:colors.surface, borderRadius:20, borderWidth:1, borderColor:colors.border,
                marginTop: spacing.md, marginBottom: spacing.xl },
  header:     { marginBottom: spacing.xxl },
  form:       { gap: 0 },
  errorBox:   { flexDirection:'row', alignItems:'center', gap:8, backgroundColor:colors.errorBg,
                padding:spacing.md, borderRadius:12, marginBottom:spacing.md },
  errorText:  { ...typography.sm, color:colors.error, flex:1 },
  forgotBtn:  { alignItems:'center', marginTop: spacing.lg },
  forgotText: { ...typography.sm, color: colors.teal, fontWeight:'600' },
  footer:     { flexDirection:'row', justifyContent:'center', marginTop: spacing.xxxl, alignItems:'center' },
  footerText: { ...typography.sm, color: colors.textSecondary },
  footerLink: { ...typography.sm, color: colors.teal, fontWeight:'700' },
});
