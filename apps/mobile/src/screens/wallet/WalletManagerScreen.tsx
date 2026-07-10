import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons }   from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { Header }   from '../../components/ui/Header';
import { Card }     from '../../components/ui/Card';
import { Button }   from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { ChainBadge } from '../../components/ui/ChainBadge';
import { colors, typography, spacing, radius } from '../../theme';
import { api }    from '../../services/api';
import { setWalletReady, switchActiveWallet } from '../../store/slices/walletSlice';
import type { AppDispatch, RootState } from '../../store';

const CHAIN_ORDER = ['tron', 'ethereum', 'bsc', 'polygon', 'solana'];
const CHAIN_LABEL: Record<string, string> = {
  tron: 'TRON', ethereum: 'Ethereum', bsc: 'BSC', polygon: 'Polygon', solana: 'Solana',
};

interface WalletEntry {
  walletIndex: number;
  label:       string;
  createdAt:   string;
  addresses:   Record<string, string>;
}

const TAB_H        = Platform.OS === 'ios' ? 84 : 68;
const FOOTER_EXTRA = Platform.OS === 'ios' ? 16 : 8;

export default function WalletManagerScreen() {
  const navigation = useNavigation<any>();
  const dispatch   = useDispatch<AppDispatch>();
  const insets     = useSafeAreaInsets();

  // The active wallet index lives in Redux (walletSlice), not local
  // component state — this is what lets every other screen (Dashboard,
  // Send, Receive, TokenDetail, Bridge, PayQR, Transactions, ...) know
  // which wallet is active too. Switching/importing/deleting here all
  // go through the switchActiveWallet thunk so Redux + AsyncStorage +
  // every other screen's data all update together.
  const activeIdx = useSelector((s: RootState) => s.wallet.activeWalletIndex);

  const [wallets,      setWallets]      = useState<WalletEntry[]>([]);
  const [expanded,     setExpanded]     = useState<number | null>(null);
  const [editingIdx,   setEditingIdx]   = useState<number | null>(null);
  const [editName,     setEditName]     = useState('');
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [showImport,   setShowImport]   = useState(false);
  const [importPhrase, setImportPhrase] = useState('');
  const [importing,    setImporting]    = useState(false);
  const [creating,     setCreating]     = useState(false);
  const [copiedKey,    setCopiedKey]    = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Load wallets from backend — single source of truth. Soft-deleted
      // wallets are already excluded server-side (isActive: true filter).
      const list = await api.getWallets();
      setWallets(Array.isArray(list) ? list : []);
    } catch (err: any) {
      Alert.alert('Error', 'Failed to load wallets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  // ── Switch active wallet ──────────────────────────────────────────────────
  const handleSwitch = (w: WalletEntry) => {
    if (w.walletIndex === activeIdx) return;
    Alert.alert(
      `Switch to ${w.label}?`,
      'The entire app will use this wallet for sending, receiving, and balances.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            // Persists to AsyncStorage, updates Redux's activeWalletIndex
            // (read by every other screen), and refetches
            // addresses/balances/transactions for wallet w.
            await dispatch(switchActiveWallet(w.walletIndex));
            Alert.alert('Switched ✓', `Now using ${w.label}`);
          },
        },
      ]
    );
  };

  // ── Rename ────────────────────────────────────────────────────────────────
  const saveRename = async (walletIndex: number) => {
    if (!editName.trim()) { Alert.alert('Name required'); return; }
    try {
      await api.renameWallet(walletIndex, editName.trim());
      await load();
    } catch {
      Alert.alert('Error', 'Failed to rename wallet');
    } finally {
      setEditingIdx(null);
      setEditName('');
    }
  };

  // ── Copy address ──────────────────────────────────────────────────────────
  const copyAddr = async (key: string, addr: string) => {
    await Clipboard.setStringAsync(addr);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // ── Create new wallet ─────────────────────────────────────────────────────
  const handleCreate = () => {
    Alert.alert(
      'Create New Wallet',
      'This generates a new seed phrase and new addresses. Your current wallet stays active until you switch.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: async () => {
            setCreating(true);
            try {
              const res = await api.createWallet();
              await load();

              if (res?.mnemonic) {
                Alert.alert(
                  '⚠️ Save your seed phrase',
                  `Write these words down and store them safely. This is shown ONCE:\n\n${res.mnemonic}`,
                  [{ text: "I've saved it" }]
                );
              } else {
                Alert.alert('Wallet created ✓', `${res?.label ?? 'New wallet'} has been created.`);
              }
            } catch (err: any) {
              Alert.alert('Error', err?.response?.data?.message ?? 'Failed to create wallet');
            } finally { setCreating(false); }
          },
        },
      ]
    );
  };

  // ── Import wallet ─────────────────────────────────────────────────────────
  const handleImport = async () => {
    const words = importPhrase.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      Alert.alert('Invalid phrase', 'Seed phrase must be exactly 12 or 24 words');
      return;
    }
    setImporting(true);
    try {
      const res = await api.importWallet({ mnemonic: importPhrase.trim() });
      // Switch to newly imported wallet (persists + refetches everywhere)
      const newIdx = res?.walletIndex ?? 0;
      await dispatch(switchActiveWallet(newIdx));
      dispatch(setWalletReady(true));
      await load();
      setShowImport(false);
      setImportPhrase('');
      Alert.alert('Imported ✓', `${res?.label ?? 'Imported wallet'} is now active.`);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to import wallet');
    } finally { setImporting(false); }
  };

  // ── Delete wallet ─────────────────────────────────────────────────────────
  const handleDelete = (w: WalletEntry) => {
    if (wallets.length <= 1) {
      Alert.alert('Cannot delete', 'You need at least one wallet. Create or import another wallet before deleting this one.');
      return;
    }
    Alert.alert(
      `Delete "${w.label}"?`,
      'This removes the wallet from your account. Make sure you\'ve saved its seed phrase — without it you will permanently lose access to any funds in it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteWallet(w.walletIndex);
              // If the deleted wallet was active, fall back to whichever
              // wallet remains first — routed through switchActiveWallet so
              // Redux + AsyncStorage + every other screen's data update
              // together, instead of pointing at a wallet that no longer
              // exists.
              if (w.walletIndex === activeIdx) {
                const remaining = wallets.filter(x => x.walletIndex !== w.walletIndex);
                const next = remaining[0];
                if (next) {
                  await dispatch(switchActiveWallet(next.walletIndex));
                }
              }
              await load();
            } catch (err: any) {
              Alert.alert('Error', err?.response?.data?.message ?? 'Failed to delete wallet');
            }
          },
        },
      ],
    );
  };

  const footerBottom = TAB_H + FOOTER_EXTRA;

  return (
    <SafeAreaView style={styles.flex} edges={[]}>
      <Header title="Manage Wallets" />
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: footerBottom + 24 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />
          }
        >
          {loading ? (
            [1, 2].map(i => (
              <Skeleton key={i} width="100%" height={72} style={{ marginBottom: spacing.md }} />
            ))
          ) : wallets.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="wallet-outline" size={36} color={colors.textTertiary} />
              <Text style={styles.emptyText}>No wallets found</Text>
              <Text style={styles.emptySubText}>Create or import a wallet below</Text>
            </View>
          ) : (
            wallets.map((w) => {
              const isActive   = w.walletIndex === activeIdx;
              const isExpanded = expanded === w.walletIndex;
              const isEditing  = editingIdx === w.walletIndex;

              return (
                <View key={w.walletIndex} style={[styles.walletCard, isActive && styles.walletCardActive]}>
                  {/* Wallet header */}
                  <TouchableOpacity
                    style={styles.walletHeader}
                    onPress={() => setExpanded(isExpanded ? null : w.walletIndex)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.avatar, isActive && styles.avatarActive]}>
                      <Text style={[styles.avatarText, isActive && { color: colors.teal }]}>
                        {w.walletIndex + 1}
                      </Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      {isEditing ? (
                        <TextInput
                          style={styles.nameInput}
                          value={editName}
                          onChangeText={setEditName}
                          autoFocus
                          onSubmitEditing={() => saveRename(w.walletIndex)}
                          onBlur={() => saveRename(w.walletIndex)}
                          placeholder="Wallet name"
                          placeholderTextColor={colors.textTertiary}
                        />
                      ) : (
                        <Text style={styles.walletName}>{w.label}</Text>
                      )}
                      <Text style={styles.walletSub}>
                        {isActive ? '✓ Active wallet' : 'Tap to expand'}
                        {w.createdAt ? ` · ${new Date(w.createdAt).toLocaleDateString()}` : ''}
                      </Text>
                    </View>

                    <View style={styles.headerRight}>
                      <TouchableOpacity
                        onPress={() => {
                          if (isEditing) { saveRename(w.walletIndex); }
                          else           { setEditingIdx(w.walletIndex); setEditName(w.label); }
                        }}
                        style={styles.iconBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={isEditing ? 'checkmark' : 'pencil-outline'}
                          size={15}
                          color={isEditing ? colors.success : colors.textTertiary}
                        />
                      </TouchableOpacity>
                      {!isEditing && (
                        <TouchableOpacity
                          onPress={() => handleDelete(w)}
                          style={styles.iconBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="trash-outline" size={15} color={colors.error} />
                        </TouchableOpacity>
                      )}
                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.textTertiary}
                      />
                    </View>
                  </TouchableOpacity>

                  {/* Expanded — addresses */}
                  {isExpanded && (
                    <View style={styles.addrSection}>
                      <View style={styles.divider} />

                      {CHAIN_ORDER.map((chain, ci) => {
                        const addr    = w.addresses?.[chain] ?? '';
                        const copyKey = `${w.walletIndex}_${chain}`;
                        const copied  = copiedKey === copyKey;
                        return (
                          <View
                            key={chain}
                            style={[
                              styles.addrRow,
                              ci < CHAIN_ORDER.length - 1 && styles.addrRowBorder,
                            ]}
                          >
                            <ChainBadge chain={chain} />
                            <View style={{ flex: 1, marginLeft: spacing.sm }}>
                              <Text style={styles.addrChainLabel}>{CHAIN_LABEL[chain]}</Text>
                              {addr ? (
                                <Text style={styles.addrText} selectable numberOfLines={1} ellipsizeMode="middle">
                                  {addr}
                                </Text>
                              ) : (
                                <Text style={styles.addrEmpty}>Not available</Text>
                              )}
                            </View>
                            {addr ? (
                              <TouchableOpacity
                                onPress={() => copyAddr(copyKey, addr)}
                                style={styles.copyBtn}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                activeOpacity={0.7}
                              >
                                <Ionicons
                                  name={copied ? 'checkmark' : 'copy-outline'}
                                  size={16}
                                  color={copied ? colors.success : colors.teal}
                                />
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        );
                      })}

                      {/* Switch button for non-active wallets */}
                      {!isActive ? (
                        <TouchableOpacity
                          style={styles.switchBtn}
                          onPress={() => handleSwitch(w)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="swap-horizontal-outline" size={16} color={colors.teal} />
                          <Text style={styles.switchBtnText}>Switch to {w.label}</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.activePill}>
                          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                          <Text style={styles.activePillText}>Currently active wallet</Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}

          {/* Import form */}
          {showImport && (
            <Card style={styles.importCard}>
              <Text style={styles.importTitle}>Import from seed phrase</Text>
              <Text style={styles.importDesc}>
                Enter your 12 or 24-word recovery phrase, separated by spaces.
              </Text>
              <TextInput
                style={styles.importInput}
                value={importPhrase}
                onChangeText={setImportPhrase}
                placeholder="word1 word2 word3 … word12"
                placeholderTextColor={colors.textTertiary}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Button label="Import" onPress={handleImport} loading={importing} size="sm" />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Cancel" variant="ghost" size="sm"
                    onPress={() => { setShowImport(false); setImportPhrase(''); }} />
                </View>
              </View>
            </Card>
          )}

          {/* Info box */}
          {!showImport && (
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.info} />
              <Text style={styles.infoText}>
                Each wallet has 5 addresses — TRON, Ethereum, BSC, Polygon, and Solana — all from one seed phrase. Pull down to refresh.
              </Text>
            </View>
          )}

          {/* Create / Import — part of the normal scroll flow, not a
              floating overlay, so they can't sit on top of the rename input
              and you can always scroll down to reach them fully. */}
          {!showImport && (
            <View style={styles.actionsRow}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Create Wallet"
                  onPress={handleCreate}
                  loading={creating}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Import Wallet"
                  variant="secondary"
                  onPress={() => setShowImport(true)}
                />
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },

  emptyBox:    { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm },
  emptyText:   { ...typography.h4, color: colors.textSecondary },
  emptySubText:{ ...typography.sm, color: colors.textTertiary },

  walletCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    borderWidth: 1.5, borderColor: colors.border,
    marginBottom: spacing.md, overflow: 'hidden',
  },
  walletCardActive: { borderColor: colors.tealBorder, backgroundColor: colors.tealBg },

  walletHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.md, gap: spacing.md,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarActive:  { backgroundColor: colors.tealBg2, borderColor: colors.teal },
  avatarText:    { fontSize: 18, fontWeight: '700' as const, color: colors.textSecondary },
  walletName:    { ...typography.h5, color: colors.text },
  walletSub:     { ...typography.xs, color: colors.textTertiary, marginTop: 2 },
  headerRight:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn:       { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.surfaceHigh },
  nameInput: {
    ...typography.h5, color: colors.text,
    borderBottomWidth: 1, borderBottomColor: colors.teal,
    paddingVertical: 2, minWidth: 120,
  },

  divider:      { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  addrSection:  { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  addrRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2 },
  addrRowBorder:{ borderBottomWidth: 1, borderBottomColor: colors.border + '60' },
  addrChainLabel:{ ...typography.xs, color: colors.textTertiary, marginBottom: 2 },
  addrText:     { ...typography.mono, color: colors.text, fontSize: 11 },
  addrEmpty:    { ...typography.xs, color: colors.textTertiary, fontStyle: 'italic' as const },
  copyBtn:      { padding: spacing.sm },

  switchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: spacing.md, paddingVertical: spacing.sm + 2,
    backgroundColor: colors.tealBg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.tealBorder,
  },
  switchBtnText: { ...typography.sm, color: colors.teal, fontWeight: '700' as const },

  activePill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.successBg, borderRadius: radius.md,
  },
  activePillText: { ...typography.xs, color: colors.success, fontWeight: '600' as const },

  importCard:  { marginBottom: spacing.md },
  importTitle: { ...typography.h4, color: colors.text, marginBottom: spacing.sm },
  importDesc:  { ...typography.sm, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  importInput: {
    backgroundColor: colors.bgTertiary, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border, padding: spacing.md,
    color: colors.text, ...typography.sm, minHeight: 100,
    textAlignVertical: 'top' as const,
  },

  infoBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.infoBg, padding: spacing.md, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.info + '30', marginBottom: spacing.xl,
  },
  infoText: { ...typography.xs, color: colors.info, flex: 1, lineHeight: 18 },

  actionsRow: {
    flexDirection: 'row', gap: spacing.sm,
    marginTop: spacing.sm, marginBottom: spacing.md,
  },
});
