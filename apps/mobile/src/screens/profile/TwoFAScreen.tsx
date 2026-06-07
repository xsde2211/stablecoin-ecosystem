import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { colors, spacing, typography, radius } from '../../theme';

export function TwoFAScreen({ navigation }: any) {
  const [step,   setStep]   = useState<'intro'|'setup'|'verify'>('intro');
  const [secret, setSecret] = useState('');
  const [qrUrl,  setQrUrl]  = useState('');
  const [code,   setCode]   = useState('');
  const [loading, setLoading] = useState(false);

  const setup2FA = async () => {
    setLoading(true);
    try {
      const result = await api.setup2FA();
      setSecret(result.secret);
      setQrUrl(result.otpauthUrl);
      setStep('setup');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const verify2FA = async () => {
    if (!code || code.length !== 6) { Alert.alert('Error', 'Enter 6-digit code'); return; }
    setLoading(true);
    try {
      await api.verify2FA(code);
      Alert.alert('Success', '2FA has been enabled on your account.', [
        { text: 'Done', onPress: () => navigation.goBack() }
      ]);
    } catch (e: any) {
      Alert.alert('Invalid Code', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.bgSecondary, colors.bg]} style={StyleSheet.absoluteFill} />
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Two-Factor Auth</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.body}>
        {step === 'intro' && (
          <>
            <View style={styles.iconWrap}>
              <Text style={{ fontSize: 40 }}>🔐</Text>
            </View>
            <Text style={styles.heading}>Secure your account</Text>
            <Text style={styles.desc}>
              2FA adds an extra layer of security. You'll need an authenticator app
              like Google Authenticator or Authy.
            </Text>
            <Button label="Set Up 2FA" onPress={setup2FA} loading={loading} />
          </>
        )}

        {step === 'setup' && (
          <>
            <Text style={styles.heading}>Scan QR Code</Text>
            <Text style={styles.desc}>
              Open your authenticator app and scan this QR code, or enter the key manually.
            </Text>
            <View style={styles.secretBox}>
              <Text style={styles.secretLabel}>Manual entry key:</Text>
              <Text style={styles.secretText} selectable>{secret}</Text>
            </View>
            <Button label="I've scanned it" onPress={() => setStep('verify')} />
          </>
        )}

        {step === 'verify' && (
          <>
            <Text style={styles.heading}>Verify Setup</Text>
            <Text style={styles.desc}>
              Enter the 6-digit code from your authenticator app to confirm setup.
            </Text>
            <Input
              label="6-digit code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
            />
            <Button label="Enable 2FA" onPress={verify2FA} loading={loading} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex:1, backgroundColor:colors.bg },
  topBar:     { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                paddingHorizontal:spacing.lg, paddingTop:60, paddingBottom:spacing.md },
  back:       { fontSize:26, color:colors.text, fontWeight:'300' },
  title:      { ...typography.h4, color:colors.text },
  body:       { flex:1, padding:spacing.lg },
  iconWrap:   { alignItems:'center', marginVertical:spacing.xl },
  heading:    { ...typography.h3, color:colors.text, marginBottom:spacing.sm },
  desc:       { ...typography.body, color:colors.textSecondary, lineHeight:22, marginBottom:spacing.xl },
  secretBox:  { backgroundColor:colors.surface, borderRadius:radius.lg, padding:spacing.lg,
                borderWidth:1, borderColor:colors.border, marginBottom:spacing.lg },
  secretLabel:{ ...typography.xs, color:colors.textSecondary, marginBottom:6, textTransform:'uppercase' },
  secretText: { ...typography.mono, color:colors.teal, fontSize:14 },
});