import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { Badge }  from '../../components/ui/Badge';
import { colors, spacing, typography, radius } from '../../theme';

const DOC_TYPES = ['AADHAAR','PAN','PASSPORT','DRIVING_LICENSE'];
const DOC_LABELS: Record<string,string> = {
  AADHAAR:'Aadhaar Card', PAN:'PAN Card', PASSPORT:'Passport', DRIVING_LICENSE:'Driving License',
};

export function KYCScreen({ navigation }: any) {
  const [status,   setStatus]   = useState<any>(null);
  const [docType,  setDocType]  = useState('AADHAAR');
  const [loading,  setLoading]  = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    api.getKycStatus().then(s => { setStatus(s); setFetching(false); }).catch(() => setFetching(false));
  }, []);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await api.submitKyc({ provider:'hyperverge', documentType:docType, documentRef:`DEMO-${Date.now()}` });
      const updated = await api.getKycStatus();
      setStatus(updated);
      Alert.alert('Submitted','KYC submitted successfully. Verification typically takes a few minutes.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  const isApproved  = status?.status === 'APPROVED';
  const isSubmitted = status?.status === 'SUBMITTED';
  const isRejected  = status?.status === 'REJECTED';
  const variant     = isApproved?'success':isRejected?'error':isSubmitted?'warning':'neutral';

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.bgSecondary, colors.bg]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>KYC Verification</Text>
        <View style={{ width:32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>

        {/* Status card */}
        <View style={styles.statusCard}>
          <LinearGradient
            colors={isApproved ? [colors.successBg, 'transparent'] : [colors.surface, 'transparent']}
            style={styles.statusGradient}
          >
            <View style={styles.statusIconWrap}>
              <Text style={{ fontSize:32 }}>
                {isApproved?'✓':isRejected?'✗':isSubmitted?'⏳':'🪪'}
              </Text>
            </View>
            <Text style={styles.statusTitle}>
              {isApproved?'Verified':isRejected?'Rejected':isSubmitted?'Under Review':'Not Verified'}
            </Text>
            <Badge
              label={status?.status ?? 'NOT SUBMITTED'}
              variant={variant}
            />
            {isApproved && (
              <Text style={styles.statusNote}>
                Your identity has been successfully verified.
              </Text>
            )}
            {isRejected && (
              <Text style={[styles.statusNote, { color:colors.error }]}>
                Reason: {status?.rejectedReason ?? 'Documents could not be verified'}
              </Text>
            )}
            {isSubmitted && (
              <Text style={styles.statusNote}>
                Your documents are being reviewed. This usually takes 2–5 minutes.
              </Text>
            )}
          </LinearGradient>
        </View>

        {/* Limits info */}
        <View style={styles.limitsCard}>
          <Text style={styles.limitsTitle}>Transaction Limits</Text>
          <View style={styles.limitRow}>
            <Text style={styles.limitLabel}>Without KYC</Text>
            <Text style={styles.limitValue}>₹50,000 / day</Text>
          </View>
          <View style={styles.limitRow}>
            <Text style={styles.limitLabel}>With KYC</Text>
            <Text style={[styles.limitValue, { color:colors.teal }]}>Unlimited</Text>
          </View>
        </View>

        {/* Form — only show if not approved */}
        {!isApproved && !isSubmitted && (
          <>
            <Text style={styles.sectionTitle}>Select Document Type</Text>
            <View style={styles.docGrid}>
              {DOC_TYPES.map(d => (
                <TouchableOpacity
                  key={d}
                  style={[styles.docOption, docType===d && styles.docOptionActive]}
                  onPress={() => setDocType(d)}
                >
                  <Text style={{ fontSize:24, marginBottom:6 }}>
                    {d==='AADHAAR'?'🪪':d==='PAN'?'💳':d==='PASSPORT'?'📘':'🚗'}
                  </Text>
                  <Text style={[styles.docLabel, docType===d && { color:colors.teal }]}>
                    {DOC_LABELS[d]}
                  </Text>
                  {docType===d && (
                    <View style={styles.docCheck}>
                      <Text style={{ color:'#000', fontSize:10, fontWeight:'800' }}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                📸 In a full implementation, you would upload document photos here. For demo purposes,
                we simulate automatic approval after submission.
              </Text>
            </View>

            <Button label="Submit KYC" onPress={handleSubmit} loading={loading} />
          </>
        )}

        <View style={{ height:100 }} />
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
  body:             { padding:spacing.lg },
  statusCard:       { borderRadius:radius.xxl, overflow:'hidden', borderWidth:1,
                      borderColor:colors.border, marginBottom:spacing.lg },
  statusGradient:   { padding:spacing.xl, alignItems:'center', gap:10 },
  statusIconWrap:   { width:72, height:72, borderRadius:36, backgroundColor:colors.surface,
                      alignItems:'center', justifyContent:'center', borderWidth:1, borderColor:colors.border },
  statusTitle:      { ...typography.h3, color:colors.text },
  statusNote:       { ...typography.sm, color:colors.textSecondary, textAlign:'center', lineHeight:20 },
  limitsCard:       { backgroundColor:colors.surface, borderRadius:radius.xl, borderWidth:1,
                      borderColor:colors.border, padding:spacing.lg, marginBottom:spacing.lg },
  limitsTitle:      { ...typography.sm, color:colors.textSecondary, fontWeight:'700',
                      textTransform:'uppercase', letterSpacing:1, marginBottom:spacing.md },
  limitRow:         { flexDirection:'row', justifyContent:'space-between', marginBottom:8 },
  limitLabel:       { ...typography.body, color:colors.textSecondary },
  limitValue:       { ...typography.body, color:colors.text, fontWeight:'600' },
  sectionTitle:     { ...typography.h4, color:colors.text, marginBottom:spacing.md },
  docGrid:          { flexDirection:'row', flexWrap:'wrap', gap:spacing.sm, marginBottom:spacing.lg },
  docOption:        { width:'47%', backgroundColor:colors.surface, borderRadius:radius.xl,
                      borderWidth:1, borderColor:colors.border, padding:spacing.lg,
                      alignItems:'center', position:'relative' },
  docOptionActive:  { borderColor:colors.teal, backgroundColor:colors.tealBg },
  docLabel:         { ...typography.sm, color:colors.textSecondary, fontWeight:'600', textAlign:'center' },
  docCheck:         { position:'absolute', top:10, right:10, width:18, height:18, borderRadius:9,
                      backgroundColor:colors.teal, alignItems:'center', justifyContent:'center' },
  notice:           { backgroundColor:colors.infoBg, borderRadius:radius.lg, padding:spacing.lg,
                      borderWidth:1, borderColor:colors.info+'44', marginBottom:spacing.lg },
  noticeText:       { ...typography.sm, color:colors.info, lineHeight:20 },
});
