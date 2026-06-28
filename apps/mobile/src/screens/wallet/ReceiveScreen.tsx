import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, Alert, Share, Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons }   from '@expo/vector-icons';
import QRCode         from 'react-native-qrcode-svg';
import { Header }     from '../../components/ui/Header';
import { Card }       from '../../components/ui/Card';
import { Skeleton }   from '../../components/ui/Skeleton';
import { TokenIcon }  from '../../components/ui/TokenIcon';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { colors, typography, spacing, radius, shadow } from '../../theme';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAddresses } from '../../store/slices/walletSlice';
import type { AppDispatch, RootState } from '../../store';

const TOKENS = ['INRX', 'EGOLD', 'ESLVR'] as const;
const CHAINS = ['tron', 'ethereum', 'bsc', 'polygon', 'solana'] as const;
const CHAIN_LABEL: Record<string, string> = {
  tron: 'TRON', ethereum: 'Ethereum', bsc: 'BSC', polygon: 'Polygon', solana: 'Solana',
};

export default function ReceiveScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const { addresses, loading } = useSelector((s: RootState) => s.wallet);

  const [chain, setChain]   = useState('tron');
  const [token, setToken]   = useState('INRX');
  const [copied, setCopied] = useState(false);

  useEffect(() => { dispatch(fetchAddresses()); }, []);

  // walletSlice.addresses can be an array [{chain,address}] or Record<chain,address>
  const addrMap: Record<string, string> = {};
  if (Array.isArray(addresses)) {
    (addresses as any[]).forEach((a: any) => { if (a?.chain && a?.address) addrMap[a.chain] = a.address; });
  } else if (addresses && typeof addresses === 'object') {
    Object.assign(addrMap, addresses);
  }

  const address  = addrMap[chain] ?? '';
  const qrValue  = address
    ? JSON.stringify({ token, chain, address, network: CHAIN_LABEL[chain] })
    : 'no-address';

  const copyAddress = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareAddress = () => {
    if (!address) return;
    Share.share({ message: `Send ${token} on ${CHAIN_LABEL[chain]} to:\n${address}` });
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Receive" subtitle="Share your address to receive funds" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Token tabs */}
        <Text style={styles.label}>Asset</Text>
        <View style={styles.tokenRow}>
          {TOKENS.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tokenChip, token === t && styles.tokenChipActive]}
              onPress={() => setToken(t)}
              activeOpacity={0.7}
            >
              <TokenIcon token={t} size={24} />
              <Text style={[styles.tokenChipText, token === t && { color: colors.text }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Chain tabs - horizontal scroll */}
        <Text style={styles.label}>Network</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chainScroll}>
          {CHAINS.map(c => (
            <TouchableOpacity
              key={c}
              style={[styles.chainChip, chain === c && styles.chainChipActive]}
              onPress={() => setChain(c)}
              activeOpacity={0.7}
            >
              <ChainBadge chain={c} />
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* QR Card */}
        <Card style={styles.qrCard}>
          {loading ? (
            <Skeleton width={220} height={220} />
          ) : address ? (
            <>
              <View style={styles.qrWrap}>
                <QRCode value={qrValue} size={200} backgroundColor="#FFFFFF" color="#000000" />
              </View>
              <View style={styles.qrLabelRow}>
                <ChainBadge chain={chain} />
                <Text style={styles.qrLabelText}>{token} · {CHAIN_LABEL[chain]}</Text>
              </View>
            </>
          ) : (
            <View style={styles.noAddrWrap}>
              <View style={styles.noAddrIcon}>
                <Ionicons name="wallet-outline" size={30} color={colors.textTertiary} />
              </View>
              <Text style={styles.noAddrTitle}>No wallet on {CHAIN_LABEL[chain]}</Text>
              <Text style={styles.noAddrDesc}>
                This chain wallet hasn't been created yet. Pull down to refresh.
              </Text>
            </View>
          )}
        </Card>

        {/* Address box */}
        {address ? (
          <Card style={styles.addrCard}>
            <Text style={styles.addrLabel}>Your {CHAIN_LABEL[chain]} Address</Text>
            <Text style={styles.addrText} selectable>{address}</Text>
            <View style={styles.addrBtns}>
              <TouchableOpacity
                style={[styles.addrBtn, copied && styles.addrBtnCopied]}
                onPress={copyAddress} activeOpacity={0.7}
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? colors.success : colors.teal} />
                <Text style={[styles.addrBtnText, copied && { color: colors.success }]}>
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addrBtn} onPress={shareAddress} activeOpacity={0.7}>
                <Ionicons name="share-outline" size={16} color={colors.teal} />
                <Text style={styles.addrBtnText}>Share</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ) : null}

        {/* Warning */}
        <View style={styles.warning}>
          <Ionicons name="warning-outline" size={16} color={colors.warning} />
          <Text style={styles.warningText}>
            Only send <Text style={{ fontWeight: '700', color: colors.text }}>{token}</Text> via{' '}
            <Text style={{ fontWeight: '700', color: colors.text }}>{CHAIN_LABEL[chain]}</Text> to this address.
            Wrong asset or wrong network = permanent loss.
          </Text>
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content:   { paddingHorizontal: spacing.xl },
  label: {
    ...typography.xs, color: colors.textSecondary, fontWeight: '700' as const,
    textTransform: 'uppercase' as const, letterSpacing: 0.8,
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  tokenRow: { flexDirection: 'row', gap: spacing.sm },
  tokenChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.sm + 2, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
  },
  tokenChipActive: { borderColor: colors.teal, backgroundColor: colors.tealBg },
  tokenChipText:   { ...typography.sm, color: colors.textSecondary, fontWeight: '700' as const },
  chainScroll:  { gap: spacing.sm, paddingBottom: spacing.xs },
  chainChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
  },
  chainChipActive: { borderColor: colors.teal, backgroundColor: colors.tealBg },
  qrCard:  { marginTop: spacing.xl, alignItems: 'center', padding: spacing.xl },
  qrWrap:  { padding: spacing.md, backgroundColor: '#FFFFFF', borderRadius: radius.lg, ...shadow.md },
  qrLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  qrLabelText: { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },
  noAddrWrap: { alignItems: 'center', paddingVertical: spacing.xxxl },
  noAddrIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  noAddrTitle: { ...typography.h4, color: colors.text, marginBottom: spacing.sm },
  noAddrDesc:  { ...typography.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.md },
  addrCard:   { marginTop: spacing.lg, padding: spacing.lg },
  addrLabel:  { ...typography.xs, color: colors.textTertiary, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: spacing.sm },
  addrText:   { ...typography.mono, color: colors.text, lineHeight: 22, marginBottom: spacing.md },
  addrBtns:   { flexDirection: 'row', gap: spacing.sm },
  addrBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: radius.lg,
    backgroundColor: colors.tealBg, borderWidth: 1, borderColor: colors.tealBorder,
  },
  addrBtnCopied: { backgroundColor: colors.successBg, borderColor: colors.success + '40' },
  addrBtnText:   { ...typography.sm, color: colors.teal, fontWeight: '700' as const },
  warning: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.warningBg, padding: spacing.md, borderRadius: radius.lg,
    marginTop: spacing.lg, borderWidth: 1, borderColor: colors.warning + '30',
  },
  warningText: { ...typography.xs, color: colors.warning, flex: 1, lineHeight: 18 },
});
