import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, Alert, TextInput, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons }     from '@expo/vector-icons';
import { Header }       from '../../components/ui/Header';
import { Button }       from '../../components/ui/Button';
import { Card }         from '../../components/ui/Card';
import { Badge }        from '../../components/ui/Badge';
import { Skeleton }     from '../../components/ui/Skeleton';
import { colors, typography, spacing, radius } from '../../theme';
import { api }          from '../../services/api';

const DOC_TYPES = [
  { label: 'Aadhaar',  value: 'AADHAAR',        hint: '12-digit number' },
  { label: 'PAN',      value: 'PAN',             hint: 'ABCDE1234F' },
  { label: 'Passport', value: 'PASSPORT',        hint: 'Passport number' },
  { label: 'Licence',  value: 'DRIVING_LICENSE', hint: 'Licence number' },
  { label: 'Voter ID', value: 'VOTER_ID',        hint: 'EPIC number' },
];

const STATUS_CFG: Record<string, { icon: any; color: string; bg: string; title: string; desc: string }> = {
  NOT_SUBMITTED: { icon: 'document-text-outline', color: colors.textSecondary, bg: colors.surface,    title: 'Verify your identity',     desc: 'Complete KYC to unlock higher limits and full access.' },
  SUBMITTED:     { icon: 'time-outline',          color: colors.warning,       bg: colors.warningBg,  title: 'Under review',             desc: 'Your documents are being reviewed. Usually takes a few minutes.' },
  APPROVED:      { icon: 'shield-checkmark',      color: colors.success,       bg: colors.successBg,  title: 'Identity Verified ✓',      desc: 'Your account is fully verified. No transaction limits.' },
  REJECTED:      { icon: 'close-circle',          color: colors.error,         bg: colors.errorBg,    title: 'Verification Failed',      desc: 'Your submission was rejected. Please resubmit.' },
};

export default function KycScreen() {
  const [kycData,    setKycData]    = useState<any>(null);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [view,       setView]       = useState<'status' | 'form'>('status');

  // ── Form state — each field is independent, never auto-fills ──
  const [docType,   setDocType]   = useState('AADHAAR');
  const [docRef,    setDocRef]    = useState('');   // user types here; never changes on its own
  const [fullName,  setFullName]  = useState('');
  const [dob,       setDob]       = useState('');
  const [address,   setAddress]   = useState('');
  const [frontImg,  setFrontImg]  = useState<string | null>(null);
  const [backImg,   setBackImg]   = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setKycData(await api.getKycStatus()); } catch {}
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const kycStatus = kycData?.kycStatus ?? 'NOT_SUBMITTED';
  const cfg       = STATUS_CFG[kycStatus] ?? STATUS_CFG.NOT_SUBMITTED;
  const canSubmit = kycStatus === 'NOT_SUBMITTED' || kycStatus === 'REJECTED';

  const selectedDocType = DOC_TYPES.find(d => d.value === docType);

  // Demo ref is computed once per render but ONLY applied when user taps "Use demo"
  const demoRef = `DEMO-${Math.floor(100000 + Math.random() * 900000)}`;

  const pickImage = async (side: 'front' | 'back') => {
    Alert.alert('Upload document', `Select ${side} side`, [
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
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
          if (!r.canceled) side === 'front' ? setFrontImg(r.assets[0].uri) : setBackImg(r.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSubmit = async () => {
    if (!docRef.trim())     { Alert.alert('Required', `Enter your ${selectedDocType?.hint ?? 'document number'}`); return; }
    if (!fullName.trim())   { Alert.alert('Required', 'Enter your full name as on the document'); return; }
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
      Alert.alert('Submitted ✓', 'Your KYC application is under review. You\'ll be notified once approved.', [
        { text: 'OK', onPress: () => { setView('status'); setTimeout(load, 4000); } },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Submission failed. Please try again.');
    } finally { setSubmitting(false); }
  };

  // ── Status view ───────────────────────────────────────────────────────────
  if (view === 'status') {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Identity Verification" />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {loading ? <Skeleton width="100%" height={160} /> : (
            <View style={[styles.statusCard, { backgroundColor: cfg.bg, borderColor: cfg.color + '40' }]}>
              <View style={[styles.statusIcon, { backgroundColor: cfg.color + '20' }]}>
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
                { icon: 'time-outline',          t: 'Usually takes 1-5 minutes to approve' },
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
              <Text style={styles.sectionTitle}>Last submission</Text>
              <Card>
                {[
                  { l: 'Document type', v: kycData.application.documentType ?? '—' },
                  { l: 'Provider',      v: kycData.application.provider ?? '—' },
                  { l: 'Submitted',     v: kycData.application.createdAt ? new Date(kycData.application.createdAt).toLocaleDateString() : '—', last: true },
                ].map(r => (
                  <View key={r.l} style={[rS.row, !r.last && rS.border]}>
                    <Text style={rS.label}>{r.l}</Text>
                    <Text style={rS.value}>{r.v}</Text>
                  </View>
                ))}
              </Card>
            </>
          )}

          <View style={{ height: spacing.xl }} />
          {canSubmit && <Button label={kycStatus === 'REJECTED' ? 'Resubmit KYC' : 'Start Verification'} onPress={() => setView('form')} />}
          {kycStatus === 'SUBMITTED' && <Button label="Refresh Status" variant="secondary" onPress={load} />}
          <View style={{ height: 100 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Form view ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Submit KYC" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <Text style={styles.fieldLabel}>Document Type *</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.docTypeRow}>
          {DOC_TYPES.map(d => (
            <TouchableOpacity
              key={d.value}
              style={[styles.docChip, docType === d.value && styles.docChipActive]}
              onPress={() => { setDocType(d.value); setDocRef(''); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.docChipText, docType === d.value && { color: colors.teal }]}>{d.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Document number — user types here; never changes automatically */}
        <Text style={styles.fieldLabel}>{selectedDocType?.label} Number *</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={docRef}
            onChangeText={setDocRef}   // only changes when user types
            placeholder={selectedDocType?.hint ?? 'Enter document number'}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        {/* Demo button — static, only sets docRef when tapped */}
        <TouchableOpacity style={styles.demoBtn} onPress={() => setDocRef(demoRef)} activeOpacity={0.7}>
          <Ionicons name="flask-outline" size={13} color={colors.info} />
          <Text style={styles.demoBtnText}>
            Testing? Tap to use demo ref — instant approval
          </Text>
        </TouchableOpacity>

        <Text style={styles.fieldLabel}>Full Name (as on document) *</Text>
        <View style={styles.inputWrap}>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Rahul Sharma" placeholderTextColor={colors.textTertiary} autoCapitalize="words" />
        </View>

        <Text style={styles.fieldLabel}>Date of Birth</Text>
        <View style={styles.inputWrap}>
          <TextInput style={styles.input} value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textTertiary} keyboardType="numeric" />
        </View>

        <Text style={styles.fieldLabel}>Address (optional)</Text>
        <View style={[styles.inputWrap, { height: 90 }]}>
          <TextInput style={[styles.input, { textAlignVertical: 'top', paddingTop: spacing.sm }]} value={address} onChangeText={setAddress} placeholder="Your residential address" placeholderTextColor={colors.textTertiary} multiline numberOfLines={3} />
        </View>

        <Text style={styles.fieldLabel}>Document Photos (optional)</Text>
        <View style={styles.uploadRow}>
          <TouchableOpacity style={[styles.uploadBox, !!frontImg && styles.uploadDone]} onPress={() => pickImage('front')} activeOpacity={0.7}>
            <Ionicons name={frontImg ? 'checkmark-circle' : 'cloud-upload-outline'} size={26} color={frontImg ? colors.success : colors.textTertiary} />
            <Text style={[styles.uploadLabel, frontImg && { color: colors.success }]}>{frontImg ? 'Front added' : 'Front side'}</Text>
            {!frontImg && <Text style={styles.uploadHint}>Camera or gallery</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.uploadBox, !!backImg && styles.uploadDone]} onPress={() => pickImage('back')} activeOpacity={0.7}>
            <Ionicons name={backImg ? 'checkmark-circle' : 'cloud-upload-outline'} size={26} color={backImg ? colors.success : colors.textTertiary} />
            <Text style={[styles.uploadLabel, backImg && { color: colors.success }]}>{backImg ? 'Back added' : 'Back side'}</Text>
            {!backImg && <Text style={styles.uploadHint}>Camera or gallery</Text>}
          </TouchableOpacity>
        </View>

        <View style={{ height: spacing.xl }} />
        <Button label="Submit for Verification" onPress={handleSubmit} loading={submitting} />
        <View style={{ height: spacing.md }} />
        <Button label="Cancel" variant="ghost" onPress={() => setView('status')} />
        <View style={{ height: 100 }} />
      </ScrollView>
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
  container: { flex: 1, backgroundColor: colors.bg },
  content:   { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 40 },
  statusCard: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.xl, alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  statusIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  statusTitle: { ...typography.h3, textAlign: 'center' },
  statusDesc:  { ...typography.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  rejectBox:   { flexDirection: 'row', gap: 6, backgroundColor: colors.errorBg, padding: spacing.sm, borderRadius: radius.md, alignItems: 'flex-start' },
  rejectText:  { ...typography.xs, color: colors.error, flex: 1 },
  sectionTitle: { ...typography.xs, color: colors.textTertiary, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.8, marginTop: spacing.xl, marginBottom: spacing.md },
  needRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  needIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.tealBg, borderWidth: 1, borderColor: colors.tealBorder, alignItems: 'center', justifyContent: 'center' },
  needText: { ...typography.sm, color: colors.textSecondary, flex: 1 },
  fieldLabel:  { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const, marginBottom: spacing.sm, marginTop: spacing.lg },
  inputWrap:   { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.md, minHeight: 52, justifyContent: 'center' },
  input:       { ...typography.body, color: colors.text, paddingVertical: spacing.md },
  docTypeRow:  { gap: spacing.sm, paddingBottom: spacing.sm },
  docChip:     { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  docChipActive: { borderColor: colors.teal, backgroundColor: colors.tealBg },
  docChipText:   { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },
  demoBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, padding: spacing.sm, backgroundColor: colors.infoBg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.info + '30' },
  demoBtnText:  { ...typography.xs, color: colors.info, flex: 1 },
  uploadRow: { flexDirection: 'row', gap: spacing.sm },
  uploadBox: { flex: 1, aspectRatio: 1.2, backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed' as const, alignItems: 'center', justifyContent: 'center', gap: 6 },
  uploadDone:  { borderColor: colors.success, borderStyle: 'solid' as const, backgroundColor: colors.successBg },
  uploadLabel: { ...typography.sm, color: colors.textSecondary, fontWeight: '600' as const },
  uploadHint:  { ...typography.xs, color: colors.textTertiary },
});
