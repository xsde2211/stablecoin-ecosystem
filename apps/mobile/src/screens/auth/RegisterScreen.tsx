import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useDispatch, useSelector } from 'react-redux';
import { registerUser } from '../../store/slices/authSlice';
import { AppDispatch, RootState } from '../../store';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { colors, spacing, typography, radius } from '../../theme';

export function RegisterScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const { loading } = useSelector((s: RootState) => s.auth);

  const [fullName, setFullName] = useState('');
  const [email,    setEmail]    = useState('');
  const [phone,    setPhone]    = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [agreed,   setAgreed]   = useState(false);

  const handleRegister = async () => {
    if (!fullName || !email || !password) { Alert.alert('Error','Fill all required fields'); return; }
    if (!agreed) { Alert.alert('Error','Please accept the terms'); return; }
    const result = await dispatch(registerUser({ fullName, email: email.trim(), phone, password }));
    if (registerUser.rejected.match(result)) {
      Alert.alert('Registration Failed', result.error.message ?? 'Please try again');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS==='ios'?'padding':'height'}>
      <LinearGradient colors={['#0A0A0F','#111118','#0A0A0F']} style={StyleSheet.absoluteFill} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Set up your self-custody wallet</Text>
        </View>

        <View style={styles.card}>
          <Input label="Full name *"     value={fullName} onChangeText={setFullName} placeholder="Rahul Sharma" autoCapitalize="words" />
          <Input label="Email address *" value={email}    onChangeText={setEmail}    placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <Input label="Phone (optional)"value={phone}    onChangeText={setPhone}    placeholder="+91 98765 43210" keyboardType="phone-pad" />
          <Input
            label="Password *"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPass}
            placeholder="Min 8 chars, uppercase, number, symbol"
            hint="Must contain uppercase, lowercase, number and special character"
            rightIcon={
              <TouchableOpacity onPress={() => setShowPass(!showPass)}>
                <Text style={{ color:colors.teal, fontSize:13, fontWeight:'600' }}>{showPass?'Hide':'Show'}</Text>
              </TouchableOpacity>
            }
          />

          <TouchableOpacity style={styles.termsRow} onPress={() => setAgreed(!agreed)}>
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed && <Text style={{ color:'#000', fontSize:11, fontWeight:'700' }}>✓</Text>}
            </View>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text style={{ color:colors.teal }}>Terms of Service</Text>
              {' '}and{' '}
              <Text style={{ color:colors.teal }}>Privacy Policy</Text>
            </Text>
          </TouchableOpacity>

          <Button label="Create Account" onPress={handleRegister} loading={loading} />
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            🔐 Your seed phrase will be shown once after account creation.{'\n'}
            Store it safely — it cannot be recovered.
          </Text>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:       { flex:1, backgroundColor:colors.bg },
  scroll:          { flexGrow:1, paddingHorizontal:spacing.lg, paddingTop:60, paddingBottom:40 },
  header:          { marginBottom:spacing.xl },
  backBtn:         { marginBottom:spacing.lg },
  backText:        { ...typography.body, color:colors.teal },
  title:           { ...typography.h2, color:colors.text, marginBottom:6 },
  subtitle:        { ...typography.body, color:colors.textSecondary },
  card:            { backgroundColor:colors.surface, borderRadius:radius.xxl,
                     borderWidth:1, borderColor:colors.border, padding:spacing.xl },
  termsRow:        { flexDirection:'row', alignItems:'flex-start', gap:12, marginBottom:spacing.lg },
  checkbox:        { width:20, height:20, borderRadius:6, borderWidth:1.5, borderColor:colors.border,
                     alignItems:'center', justifyContent:'center', marginTop:1 },
  checkboxChecked: { backgroundColor:colors.teal, borderColor:colors.teal },
  termsText:       { ...typography.sm, color:colors.textSecondary, flex:1, lineHeight:20 },
  notice:          { marginTop:spacing.xl, padding:spacing.lg, backgroundColor:colors.warningBg,
                     borderRadius:radius.lg, borderWidth:1, borderColor:colors.warning+'44' },
  noticeText:      { ...typography.sm, color:colors.warning, lineHeight:20 },
});
