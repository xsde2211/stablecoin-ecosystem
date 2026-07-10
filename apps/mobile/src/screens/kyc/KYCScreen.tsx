import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons }     from '@expo/vector-icons';
import { Header }       from '../../components/ui/Header';
import { Button }       from '../../components/ui/Button';
import { Card }         from '../../components/ui/Card';
import { Skeleton }     from '../../components/ui/Skeleton';
import { colors, typography, spacing, radius } from '../../theme';
import { api } from '../../services/api';

// Tab bar is still visible when KYC is pushed from ProfileStack / DashboardStack
// So footer must clear: home indicator + tab bar height
const TAB_BAR_H = Platform.OS === 'ios' ? 84 : 68;

const DOC_TYPES = [
  { label: 'Aadhaar',  value: 'AADHAAR',        hint: '12-digit number' },
  { label: 'PAN',      value: 'PAN',             hint: 'ABCDE1234F' },
  { label: 'Passport', value: 'PASSPORT',        hint: 'Passport number' },
  { label: 'Licence',  value: 'DRIVING_LICENSE', hint: 'Licence number' },
  { label: 'Voter ID', value: 'VOTER_ID',        hint: 'EPIC number' },
];

const STATUS_CFG: Record<string, {
  icon: any; color: string; bg: string; title: string; desc: string;
}> = {
  NOT_SUBMITTED: {
    icon: 'document-text-outline', color: colors.textSecondary,
    bg: colors.surface,
    title: 'Verify your identity',
    desc: 'Complete KYC to unlock higher limits and full access to all features.',
  },
  SUBMITTED: {
    icon: 'time-outline', color: colors.warning,
    bg: colors.warningBg,
    title: 'Under review',
    desc: 'Your documents are being reviewed. This usually takes a few minutes.',
  },
  APPROVED: {
    icon: 'shield-checkmark', color: colors.success,
    bg: colors.successBg,
    title: 'Identity Verified ✓',
    desc: 'Your account is fully verified. No transaction limits apply.',
  },
  REJECTED: {
    icon: 'close-circle', color: colors.error,
    bg: colors.errorBg,
    title: 'Verification Failed',
    desc: 'Your submission was rejected. Please resubmit with correct information.',
  },
};

// Single button footer height (status view only — form view buttons now scroll inline)
const BTN_H = 54;

export default function KycScreen() {
  const insets = useSafeAreaInsets();
  // Footer must sit above the tab bar which is still visible behind this screen
  const footerBottom = TAB_BAR_H + 8;
  // Single button footer total height (for scroll padding) — used by status view only
  const footerH = BTN_H + spacing.md + footerBottom;

  const [kycData,    setKycData]    = useState<any>(null);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [view,       setView]       = useState<'status' | 'form'>('status');

  const [docType,  setDocType]  = useState('AADHAAR');
  const [docRef,   setDocRef]   = useState('');
  const [fullName, setFullName] = useState('');
  const [dob,      setDob]      = useState('');
  const [address,  setAddress]  = useState('');
  const [frontImg, setFrontImg] = useState<string | null>(null);
  const [backImg,  setBackImg]  = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setKycData(await api.getKycStatus()); }
    catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const kycStatus       = kycData?.kycStatus ?? 'NOT_SUBMITTED';
  const cfg             = STATUS_CFG[kycStatus] ?? STATUS_CFG.NOT_SUBMITTED;
  const canSubmit       = kycStatus === 'NOT_SUBMITTED' || kycStatus === 'REJECTED';
  const selectedDocType = DOC_TYPES.find(d => d.value === docType);
  const demoRef         = `DEMO-${Math.floor(100000 + Math.random() * 900000)}`;

  const pickImage = async (side: 'front' | 'back') => {
    Alert.alert('Upload document', `Choose ${side} side source`, [
      {
        text: 'Camera', onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Permission needed', 'Camera access required.'); return; }
          const r = await ImagePicker.launchCameraAsync({ quality: 0.8 });
          if (!r.canceled) side === 'front' ? setFrontImg(r.assets[0].uri) : setBackImg(r.assets[0].uri);
        },
      },
      {
        text: 'Gallery', onPress: async () => {
          const r = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
          });
          if (!r.canceled) side === 'front' ? setFrontImg(r.assets[0].uri) : setBackImg(r.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSubmit = async () => {
    if (!docRef.trim())   { Alert.alert('Required', `Enter your ${selectedDocType?.hint ?? 'document number'}`); return; }
    if (!fullName.trim()) { Alert.alert('Required', 'Enter your full name as on the document'); return; }
    setSubmitting(true);
    try {
      await api.submitKyc({
        provider:     'manual',
        documentType: docType,
        documentRef:  docRef.trim(),
        fullName:     fullName.trim(),
        dateOfBirth:  dob || undefined,
        address:      address || undefined,
      });
      Alert.alert('Submitted ✓', "Your KYC application is under review. You'll be notified once approved.", [
        { text: 'OK', onPress: () => { setView('status'); setTimeout(load, 4000); } },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Submission failed. Please try again.');
    } finally { setSubmitting(false); }
  };

  // ── STATUS VIEW ────────────────────────────────────────────────────────────
  if (view === 'status') {
    return (
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <Header title="Identity Verification" />
        <View style={styles.flex}>
          {/* ScrollView with paddingBottom = footer height so content never hides under footer */}
          <ScrollView
            contentContainerStyle={[styles.statusContent, { paddingBottom: footerH + spacing.xl }]}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <Skeleton width="100%" height={160} style={{ borderRadius: radius.xl }} />
            ) : (
              <View style={[styles.statusCard, { backgroundColor: cfg.bg, borderColor: cfg.color + '40' }]}>
                <View style={[styles.statusIconWrap, { backgroundColor: cfg.color + '20' }]}>
                  <Ionicons name={cfg.icon} size={32} color={cfg.color} />
                </View>
                <Text style={[styles.statusTitle, { color: cfg.color }]}>{cfg.title}</Text>
                <Text style={styles.statusDesc}>{cfg.desc}</Text>
                {kycData?.application?.rejectedReason && (
                  <View style={styles.rejectBox}>
                    <Ionicons name="alert-circle" size={14} color={colors.error} />
                    <Text style={styles.rejectText}>{kycData.application.rejectedReason}</Text>
                  </View>
                )}
              </View>
            )}

            {kycStatus === 'NOT_SUBMITTED' && (
              <>
                <Text style={styles.sectionTitle}>What you'll need</Text>
                {[
                  { icon: 'document-text-outline', t: 'Government ID (Aadhaar, PAN, Passport, etc.)' },
                  { icon: 'camera-outline',        t: 'Photo of front & back of your document' },
                  { icon: 'time-outline',          t: 'Approval usually takes 1-5 minutes' },
                ].map((item, i) => (
                  <View key={i} style={styles.needRow}>
                    <View style={styles.needIcon}>
                      <Ionicons name={item.icon as any} size={18} color={colors.teal} />
                    </View>
                    <Text style={styles.needText}>{item.t}</Text>
                  </View>
                ))}
              </>
            )}

            {kycData?.application && (
              <>
                <Text style={styles.sectionTitle}>Last Submission</Text>
                <Card>
                  {[
                    { l: 'Document type', v: kycData.application.documentType ?? '—' },
                    { l: 'Provider',      v: kycData.application.provider ?? '—' },
                    { l: 'Submitted',     v: kycData.application.createdAt
                        ? new Date(kycData.application.createdAt).toLocaleDateString()
                        : '—',
                      last: true },
                  ].map(r => (
                    <View key={r.l} style={[rS.row, !r.last && rS.border]}>
                      <Text style={rS.label}>{r.l}</Text>
                      <Text style={rS.value}>{r.v}</Text>
                    </View>
                  ))}
                </Card>
              </>
            )}
          </ScrollView>

          {/* Absolute footer — always visible (status view only) */}
          {!loading && (
            <View style={[styles.footer, { bottom: footerBottom }]}>
              {canSubmit && (
                <Button
                  label={kycStatus === 'REJECTED' ? 'Resubmit KYC' : 'Start Verification'}
                  onPress={() => setView('form')}
                />
              )}
              {kycStatus === 'SUBMITTED' && (
                <Button label="Refresh Status" variant="secondary" onPress={load} />
              )}
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── FORM VIEW ──────────────────────────────────────────────────────────────
  // Submit / Cancel buttons now live inline at the end of the scroll content
  // (previously an absolutely-positioned floating footer, which sat on top of
  // input fields — especially the multiline Address field — while typing).
  // Now they simply appear after the last field as you scroll down.
  return (
    <SafeAreaView style={styles.flex} edges={[]}>
      <Header title="Submit KYC" />
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[
            styles.formContent,
            { paddingBottom: TAB_BAR_H + spacing.xl * 2 + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.fieldLabel}>Document Type *</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.docTypeRow}
          >
            {DOC_TYPES.map(d => (
              <TouchableOpacity
                key={d.value}
                style={[styles.docChip, docType === d.value && styles.docChipActive]}
                onPress={() => { setDocType(d.value); setDocRef(''); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.docChipText, docType === d.value && { color: colors.teal }]}>
                  {d.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.fieldLabel}>{selectedDocType?.label} Number *</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={docRef}
              onChangeText={setDocRef}
              placeholder={selectedDocType?.hint ?? 'Enter document number'}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>

          <TouchableOpacity style={styles.demoBtn} onPress={() => setDocRef(demoRef)} activeOpacity={0.7}>
            <Ionicons name="flask-outline" size={13} color={colors.info} />
            <Text style={styles.demoBtnText}>Testing? Tap to use demo ref — instant approval</Text>
          </TouchableOpacity>

          <Text style={styles.fieldLabel}>Full Name (as on document) *</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Rahul Sharma"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
            />
          </View>

          <Text style={styles.fieldLabel}>Date of Birth</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={dob}
              onChangeText={setDob}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              keyboardType="numeric"
            />
          </View>

          <Text style={styles.fieldLabel}>Address (optional)</Text>
          <View style={[styles.inputWrap, { height: 90 }]}>
            <TextInput
              style={[styles.input, { textAlignVertical: 'top', paddingTop: spacing.sm }]}
              value={address}
              onChangeText={setAddress}
              placeholder="Your residential address"
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={3}
            />
          </View>

          <Text style={styles.fieldLabel}>Document Photos (optional)</Text>
          <View style={styles.uploadRow}>
            <TouchableOpacity
              style={[styles.uploadBox, !!frontImg && styles.uploadDone]}
              onPress={() => pickImage('front')}
              activeOpacity={0.7}
            >
              <Ionicons
                name={frontImg ? 'checkmark-circle' : 'cloud-upload-outline'}
                size={26}
                color={frontImg ? colors.success : colors.textTertiary}
              />
              <Text style={[styles.uploadLabel, !!frontImg && { color: colors.success }]}>
                {frontImg ? 'Front added' : 'Front side'}
              </Text>
              {!frontImg && <Text style={styles.uploadHint}>Camera or gallery</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.uploadBox, !!backImg && styles.uploadDone]}
              onPress={() => pickImage('back')}
              activeOpacity={0.7}
            >
              <Ionicons
                name={backImg ? 'checkmark-circle' : 'cloud-upload-outline'}
                size={26}
                color={backImg ? colors.success : colors.textTertiary}
              />
              <Text style={[styles.uploadLabel, !!backImg && { color: colors.success }]}>
                {backImg ? 'Back added' : 'Back side'}
              </Text>
              {!backImg && <Text style={styles.uploadHint}>Camera or gallery</Text>}
            </TouchableOpacity>
          </View>

          {/* Submit / Cancel — inline now, part of normal scroll flow */}
          <View style={styles.inlineFormActions}>
            <Button label="Submit for Verification" onPress={handleSubmit} loading={submitting} />
            <View style={{ height: spacing.sm }} />
            <Button label="Cancel" variant="ghost" onPress={() => setView('status')} />
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const rS = StyleSheet.create({
  row:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  border: { borderBottomWidth: 1, borderBottomColor: colors.border },
  label:  { ...typography.sm, color: colors.textSecondary },
  value:  { ...typography.sm, color: colors.text, fontWeight: '600' as const },
});

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: colors.bg },

  // Absolute footer that always floats above content (status view only)
  footer: {
    position:        'absolute',
    left:            spacing.xl,
    right:           spacing.xl,
    backgroundColor: colors.bg,
    paddingTop:      spacing.md,
    borderTopWidth:  1,
    borderTopColor:  colors.border,
  },

  statusContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  statusCard: {
    borderRadius:  radius.xl,
    borderWidth:   1,
    padding:       spacing.xl,
    alignItems:    'center',
    gap:           spacing.sm,
    marginBottom:  spacing.xl,
  },
  statusIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  statusTitle:   { ...typography.h3, textAlign: 'center' },
  statusDesc:    { ...typography.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  rejectBox:     {
    flexDirection: 'row', gap: 6,
    backgroundColor: colors.errorBg, padding: spacing.sm,
    borderRadius: radius.md, alignItems: 'flex-start',
  },
  rejectText:    { ...typography.xs, color: colors.error, flex: 1 },
  sectionTitle:  {
    ...typography.xs, color: colors.textTertiary, fontWeight: '700' as const,
    textTransform: 'uppercase' as const, letterSpacing: 0.8,
    marginTop: spacing.xl, marginBottom: spacing.md,
  },
  needRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  needIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.tealBg, borderWidth: 1, borderColor: colors.tealBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  needText: { ...typography.sm, color: colors.textSecondary, flex: 1 },

  formContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  fieldLabel:  {
    ...typography.sm, color: colors.textSecondary,
    fontWeight: '600' as const, marginBottom: spacing.sm, marginTop: spacing.lg,
  },
  inputWrap:  {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: spacing.md, minHeight: 52, justifyContent: 'center',
  },
  input:      { ...typography.body, color: colors.text, paddingVertical: spacing.md },
  docTypeRow: { gap: spacing.sm, paddingBottom: spacing.sm },
  docChip:    {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    borderRadius: radius.full, backgroundColor: colors.surface,
    borderWidth: 1.5, borderColor: colors.border,
  },
  docChipActive: { borderColor: colors.teal, backgroundColor: colors.tealBg },
  docChipText:   { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },
  demoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: spacing.sm, padding: spacing.sm,
    backgroundColor: colors.infoBg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.info + '30',
  },
  demoBtnText: { ...typography.xs, color: colors.info, flex: 1 },
  uploadRow:  { flexDirection: 'row', gap: spacing.sm },
  uploadBox: {
    flex: 1, aspectRatio: 1.2, backgroundColor: colors.surface,
    borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.border,
    borderStyle: 'dashed' as const, alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  uploadDone:  { borderColor: colors.success, borderStyle: 'solid' as const, backgroundColor: colors.successBg },
  uploadLabel: { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },
  uploadHint:  { ...typography.xs, color: colors.textTertiary },

  // Submit/Cancel buttons — now inline at end of scroll content, not a floating footer
  inlineFormActions: {
    marginTop:    spacing.xxl,
    paddingTop:   spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});