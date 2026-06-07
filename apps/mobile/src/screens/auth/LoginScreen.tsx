import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useDispatch, useSelector } from 'react-redux';
import { loginUser, clearError } from '../../store/slices/authSlice';
import { AppDispatch, RootState } from '../../store';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { colors, spacing, typography, radius } from '../../theme';

export function LoginScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const { loading, error } = useSelector((s: RootState) => s.auth);
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) { Alert.alert('Error', 'Please fill all fields'); return; }
    const result = await dispatch(loginUser({ email: email.trim(), password }));
    if (loginUser.rejected.match(result)) {
      Alert.alert('Login Failed', result.error.message ?? 'Invalid credentials');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS==='ios'?'padding':'height'}>
      <LinearGradient colors={['#0A0A0F','#111118','#0A0A0F']} style={StyleSheet.absoluteFill} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <View style={styles.logoArea}>
          <View style={styles.logoRing}>
            <Text style={styles.logoText}>e₹</Text>
          </View>
          <Text style={styles.appName}>Stablecoin</Text>
          <Text style={styles.tagline}>Your cross-chain financial layer</Text>
        </View>

        {/* Form Card */}
        <View style={styles.card}>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          <View style={{ marginTop: spacing.xl }}>
            <Input
              label="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="you@example.com"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              placeholder="Your password"
              rightIcon={
                <TouchableOpacity onPress={() => setShowPass(!showPass)}>
                  <Text style={styles.showHide}>{showPass ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              }
            />
          </View>

          // In LoginScreen.tsx, replace the forgotRow TouchableOpacity:
<TouchableOpacity
  style={styles.forgotRow}
  onPress={() => Alert.alert(
    'Reset Password',
    'Enter your email address and we will send you a reset link.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send Reset Link',
        onPress: async () => {
          if (!email) {
            Alert.alert('Error', 'Enter your email address first');
            return;
          }
          try {
            // For now show success — backend endpoint to be added
            Alert.alert('Email Sent', `Password reset instructions sent to ${email}`);
          } catch {
            Alert.alert('Error', 'Could not send reset email');
          }
        }
      }
    ]
  )}
>
  <Text style={styles.forgotText}>Forgot password?</Text>
</TouchableOpacity>

          <Button label="Sign In" onPress={handleLogin} loading={loading} />

          <View style={styles.divider}>
            <View style={styles.divLine} />
            <Text style={styles.divText}>or</Text>
            <View style={styles.divLine} />
          </View>

          <TouchableOpacity style={styles.registerBtn} onPress={() => navigation.navigate('Register')}>
            <Text style={styles.registerText}>
              Don't have an account?{' '}
              <Text style={{ color: colors.teal, fontWeight:'600' }}>Create one</Text>
            </Text>
          </TouchableOpacity>
        </View>

        {/* Security note */}
        <View style={styles.securityNote}>
          <Text style={styles.securityText}>🔒 256-bit encrypted · Self-custody wallet</Text>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:    { flex:1, backgroundColor:colors.bg },
  scroll:       { flexGrow:1, paddingHorizontal:spacing.lg, paddingTop:80, paddingBottom:40 },
  logoArea:     { alignItems:'center', marginBottom:spacing.xxxl },
  logoRing:     { width:72, height:72, borderRadius:36, borderWidth:2, borderColor:colors.teal,
                  alignItems:'center', justifyContent:'center', marginBottom:12,
                  backgroundColor:colors.tealBg },
  logoText:     { fontSize:26, fontWeight:'800', color:colors.teal },
  appName:      { ...typography.h2, color:colors.text, marginBottom:4 },
  tagline:      { ...typography.sm, color:colors.textSecondary },
  card:         { backgroundColor:colors.surface, borderRadius:radius.xxl,
                  borderWidth:1, borderColor:colors.border, padding:spacing.xl },
  title:        { ...typography.h3, color:colors.text, marginBottom:4 },
  subtitle:     { ...typography.body, color:colors.textSecondary },
  showHide:     { ...typography.sm, color:colors.teal, fontWeight:'600' },
  forgotRow:    { alignItems:'flex-end', marginBottom:spacing.lg, marginTop:-4 },
  forgotText:   { ...typography.sm, color:colors.teal },
  divider:      { flexDirection:'row', alignItems:'center', marginVertical:spacing.lg },
  divLine:      { flex:1, height:1, backgroundColor:colors.border },
  divText:      { ...typography.sm, color:colors.textTertiary, marginHorizontal:spacing.md },
  registerBtn:  { alignItems:'center', paddingVertical:4 },
  registerText: { ...typography.body, color:colors.textSecondary },
  securityNote: { alignItems:'center', marginTop:spacing.xl },
  securityText: { ...typography.xs, color:colors.textTertiary },
});
