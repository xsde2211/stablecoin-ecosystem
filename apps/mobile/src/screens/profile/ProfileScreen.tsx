import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert, Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useDispatch, useSelector } from 'react-redux';
import { logoutUser } from '../../store/slices/authSlice';
import { AppDispatch, RootState } from '../../store';
import { Badge } from '../../components/ui/Badge';
import { colors, spacing, typography, radius } from '../../theme';

function SettingRow({
  icon, label, value, onPress, isSwitch, switchVal, onSwitch, danger,
}: any) {
  return (
    <TouchableOpacity style={styles.settingRow} onPress={onPress} activeOpacity={onPress?0.7:1}>
      <View style={[styles.settingIcon, danger && { backgroundColor:colors.errorBg }]}>
        <Text style={{ fontSize:18 }}>{icon}</Text>
      </View>
      <View style={{ flex:1 }}>
        <Text style={[styles.settingLabel, danger && { color:colors.error }]}>{label}</Text>
        {value && <Text style={styles.settingValue}>{value}</Text>}
      </View>
      {isSwitch ? (
        <Switch
          value={switchVal}
          onValueChange={onSwitch}
          trackColor={{ false:colors.border, true:colors.teal }}
          thumbColor="#fff"
        />
      ) : (
        <Text style={[styles.settingArrow, danger && { color:colors.error }]}>›</Text>
      )}
    </TouchableOpacity>
  );
}

export function ProfileScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((s: RootState) => s.auth);
  const [biometric, setBiometric] = useState(false);
  const [notifications, setNotifications] = useState(true);

  const handleLogout = () => {
    Alert.alert('Logout','Are you sure you want to logout?', [
      { text:'Cancel', style:'cancel' },
      { text:'Logout', style:'destructive', onPress:() => dispatch(logoutUser()) },
    ]);
  };

  const kycStatus = user?.kycStatus ?? 'PENDING';
  const kycVariant = kycStatus==='APPROVED'?'success':kycStatus==='REJECTED'?'error':'warning';

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.bgSecondary, colors.bg]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
        <View style={{ width:32 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* User card */}
        <View style={styles.userCard}>
          <LinearGradient colors={[colors.tealBg, 'transparent']} style={styles.userGradient}>
            <View style={styles.userAvatar}>
              <Text style={styles.userAvatarText}>
                {(user?.email?.[0] ?? 'U').toUpperCase()}
              </Text>
            </View>
            <Text style={styles.userEmail}>{user?.email ?? 'user@example.com'}</Text>
            <View style={styles.userBadges}>
              <Badge label={`Role: ${user?.role ?? 'USER'}`} variant="neutral" />
              <Badge label={`KYC: ${kycStatus}`} variant={kycVariant} />
            </View>
          </LinearGradient>
        </View>

        {/* Settings sections */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.settingsCard}>
            <SettingRow icon="🪪" label="KYC Verification"
              value={kycStatus==='APPROVED'?'Verified':'Tap to verify'}
              onPress={() => navigation.navigate('KYC')} />
            <SettingRow icon="🔐" label="Two-Factor Authentication"
              value="Protect your account"
              onPress={() => Alert.alert('2FA','2FA setup coming soon')} />
            <SettingRow icon="🔑" label="Change Password"
              onPress={() => Alert.alert('Password','Change password coming soon')} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>
          <View style={styles.settingsCard}>
            <SettingRow icon="👆" label="Biometric Login"
              isSwitch switchVal={biometric} onSwitch={setBiometric} />
            <SettingRow icon="🔔" label="Push Notifications"
              isSwitch switchVal={notifications} onSwitch={setNotifications} />
            <SettingRow icon="📱" label="Connected Devices"
              value="2 devices" onPress={() => Alert.alert('Devices','Manage devices coming soon')} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wallet</Text>
          <View style={styles.settingsCard}>
            <SettingRow icon="💾" label="Backup Seed Phrase"
              value="Keep it safe"
              onPress={() => Alert.alert('Backup','Export seed phrase coming soon')} />
            <SettingRow icon="📋" label="Transaction History"
              onPress={() => navigation.navigate('Transactions')} />
            <SettingRow icon="🌐" label="Networks"
              value="TRON, Ethereum, BSC, Polygon"
              onPress={() => {}} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>
          <View style={styles.settingsCard}>
            <SettingRow icon="📖" label="Documentation" onPress={() => {}} />
            <SettingRow icon="💬" label="Contact Support" onPress={() => {}} />
            <SettingRow icon="ℹ️" label="App Version" value="1.0.0" />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.settingsCard}>
            <SettingRow icon="🚪" label="Logout" onPress={handleLogout} danger />
          </View>
        </View>

        <View style={{ height:100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex:1, backgroundColor:colors.bg },
  topBar:         { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                    paddingHorizontal:spacing.lg, paddingTop:60, paddingBottom:spacing.md },
  back:           { fontSize:26, color:colors.text, fontWeight:'300' },
  title:          { ...typography.h4, color:colors.text },
  userCard:       { marginHorizontal:spacing.lg, marginBottom:spacing.lg,
                    borderRadius:radius.xxl, overflow:'hidden', borderWidth:1, borderColor:colors.tealBorder },
  userGradient:   { padding:spacing.xl, alignItems:'center' },
  userAvatar:     { width:72, height:72, borderRadius:36, backgroundColor:colors.tealBg,
                    borderWidth:2, borderColor:colors.teal, alignItems:'center', justifyContent:'center', marginBottom:12 },
  userAvatarText: { fontSize:28, fontWeight:'700', color:colors.teal },
  userEmail:      { ...typography.body, color:colors.text, fontWeight:'600', marginBottom:spacing.md },
  userBadges:     { flexDirection:'row', gap:spacing.sm },
  section:        { paddingHorizontal:spacing.lg, marginBottom:spacing.lg },
  sectionTitle:   { ...typography.xs, color:colors.textTertiary, fontWeight:'700',
                    textTransform:'uppercase', letterSpacing:1, marginBottom:spacing.sm },
  settingsCard:   { backgroundColor:colors.surface, borderRadius:radius.xl,
                    borderWidth:1, borderColor:colors.border, overflow:'hidden' },
  settingRow:     { flexDirection:'row', alignItems:'center', padding:spacing.lg,
                    borderBottomWidth:1, borderBottomColor:colors.border+'55', gap:12 },
  settingIcon:    { width:38, height:38, borderRadius:radius.md, backgroundColor:colors.bgTertiary,
                    alignItems:'center', justifyContent:'center' },
  settingLabel:   { ...typography.body, color:colors.text, fontWeight:'500' },
  settingValue:   { ...typography.xs, color:colors.textTertiary, marginTop:2 },
  settingArrow:   { fontSize:20, color:colors.textTertiary },
});
