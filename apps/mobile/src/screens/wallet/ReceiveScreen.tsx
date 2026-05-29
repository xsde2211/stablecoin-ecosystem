import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Share } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { colors, spacing, typography, radius } from '../../theme';

const CHAINS = ['tron','ethereum','bsc','polygon','solana'];

export function ReceiveScreen({ navigation }: any) {
  const { addresses } = useSelector((s: RootState) => s.wallet);
  const [chain, setChain] = useState('tron');

  const address = addresses?.[chain] ?? '';

  const copy = async () => {
    await Clipboard.setStringAsync(address);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied!','Address copied to clipboard');
  };

  const shareAddr = async () => {
    await Share.share({ message: `My ${chain} address: ${address}` });
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.bgSecondary, colors.bg]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Receive</Text>
        <View style={{ width:32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>

        {/* Chain tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chainScroll}>
          {CHAINS.map(c => (
            <TouchableOpacity key={c} style={[styles.chainTab, chain===c && styles.chainTabActive]}
                              onPress={() => setChain(c)}>
              <Text style={[styles.chainTabText, chain===c && styles.chainTabTextActive]}>
                {c.charAt(0).toUpperCase()+c.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* QR Code */}
        <View style={styles.qrCard}>
          <Text style={styles.qrLabel}>Scan to pay</Text>
          {address ? (
            <View style={styles.qrWrapper}>
              <QRCode
                value={address}
                size={200}
                color={colors.text}
                backgroundColor="transparent"
              />
            </View>
          ) : (
            <View style={[styles.qrWrapper, { alignItems:'center', justifyContent:'center' }]}>
              <Text style={{ color:colors.textTertiary }}>No wallet — create one first</Text>
            </View>
          )}
          <ChainBadge chain={chain} />
        </View>

        {/* Address */}
        <View style={styles.addressCard}>
          <Text style={styles.addressLabel}>Your {chain} address</Text>
          <Text style={styles.addressText} numberOfLines={2} selectable>
            {address || 'No wallet found'}
          </Text>
          <View style={styles.addressActions}>
            <TouchableOpacity style={styles.addrBtn} onPress={copy}>
              <Text style={styles.addrBtnText}>⎘ Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addrBtn} onPress={shareAddr}>
              <Text style={styles.addrBtnText}>↗ Share</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Warning */}
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            ⚠️ Only send {chain === 'tron' ? 'TRC20' : 'ERC20'} tokens to this address.
            Sending wrong tokens may result in permanent loss.
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:        { flex:1, backgroundColor:colors.bg },
  topBar:           { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                      paddingHorizontal:spacing.lg, paddingTop:60, paddingBottom:spacing.md },
  back:             { fontSize:26, color:colors.text, fontWeight:'300' },
  title:            { ...typography.h4, color:colors.text },
  body:             { padding:spacing.lg, alignItems:'center' },
  chainScroll:      { marginBottom:spacing.xl, alignSelf:'stretch' },
  chainTab:         { paddingHorizontal:spacing.lg, paddingVertical:8, marginRight:spacing.sm,
                      borderRadius:radius.full, backgroundColor:colors.surface,
                      borderWidth:1, borderColor:colors.border },
  chainTabActive:   { backgroundColor:colors.tealBg, borderColor:colors.teal },
  chainTabText:     { ...typography.sm, color:colors.textSecondary, fontWeight:'600' },
  chainTabTextActive:{ color:colors.teal },
  qrCard:           { backgroundColor:colors.surface, borderRadius:radius.xxl, borderWidth:1,
                      borderColor:colors.border, padding:spacing.xl, alignItems:'center',
                      marginBottom:spacing.lg, width:'100%' },
  qrLabel:          { ...typography.xs, color:colors.textSecondary, letterSpacing:1,
                      textTransform:'uppercase', marginBottom:spacing.lg },
  qrWrapper:        { width:220, height:220, alignItems:'center', justifyContent:'center',
                      marginBottom:spacing.lg, backgroundColor:colors.bgTertiary,
                      borderRadius:radius.xl, padding:10 },
  addressCard:      { backgroundColor:colors.surface, borderRadius:radius.xl, borderWidth:1,
                      borderColor:colors.border, padding:spacing.lg, width:'100%', marginBottom:spacing.lg },
  addressLabel:     { ...typography.xs, color:colors.textSecondary, textTransform:'uppercase', letterSpacing:1, marginBottom:8 },
  addressText:      { ...typography.mono, color:colors.text, lineHeight:22, marginBottom:spacing.md },
  addressActions:   { flexDirection:'row', gap:spacing.sm },
  addrBtn:          { flex:1, paddingVertical:10, backgroundColor:colors.tealBg, borderRadius:radius.lg,
                      alignItems:'center', borderWidth:1, borderColor:colors.tealBorder },
  addrBtnText:      { ...typography.sm, color:colors.teal, fontWeight:'700' },
  warning:          { backgroundColor:colors.warningBg, borderRadius:radius.lg, padding:spacing.lg,
                      borderWidth:1, borderColor:colors.warning+'44', width:'100%' },
  warningText:      { ...typography.sm, color:colors.warning, lineHeight:20 },
});
