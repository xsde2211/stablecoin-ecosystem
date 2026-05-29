import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Camera, CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { colors, spacing, typography, radius } from '../../theme';

const { width } = Dimensions.get('window');
const FRAME = width * 0.65;

export function ScanScreen({ navigation, route }: any) {
  const [permission,  setPermission]  = useState<boolean|null>(null);
  const [scanned,     setScanned]     = useState(false);
  const onScan = route?.params?.onScan;

  useEffect(() => {
    Camera.requestCameraPermissionsAsync().then(({ granted }) => setPermission(granted));
  }, []);

  const handleScan = async ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      const parsed = JSON.parse(data);
      // QR payment format
      if (parsed.paymentId) {
        navigation.navigate('PaymentConfirm', { payment: parsed });
        return;
      }
    } catch {}

    // Plain address
    if (onScan) {
      onScan(data);
      navigation.goBack();
    } else {
      Alert.alert('Scanned', data, [
        { text:'Copy', onPress:() => {} },
        { text:'Done', onPress:() => navigation.goBack() },
      ]);
    }
  };

  if (permission === null) return <View style={styles.container} />;

  if (!permission) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={[colors.bgSecondary, colors.bg]} style={StyleSheet.absoluteFill} />
        <View style={styles.permissionBox}>
          <Text style={{ fontSize:48, marginBottom:spacing.lg }}>📷</Text>
          <Text style={styles.permTitle}>Camera Access Needed</Text>
          <Text style={styles.permText}>Allow camera access to scan QR codes for payments</Text>
          <TouchableOpacity style={styles.permBtn}
            onPress={() => Camera.requestCameraPermissionsAsync().then(({ granted }) => setPermission(granted))}>
            <Text style={styles.permBtnText}>Grant Access</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={StyleSheet.absoluteFill} onBarcodeScanned={scanned ? undefined : handleScan} />

      {/* Dark overlay with cutout */}
      <View style={styles.overlay}>
        <View style={styles.overlayTop} />
        <View style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />
          <View style={styles.scanFrame}>
            {/* Corner marks */}
            {[{top:0,left:0},{top:0,right:0},{bottom:0,left:0},{bottom:0,right:0}].map((pos,i) => (
              <View key={i} style={[styles.corner, pos]} />
            ))}
            <View style={styles.scanLine} />
          </View>
          <View style={styles.overlaySide} />
        </View>
        <View style={styles.overlayBottom}>
          <Text style={styles.scanHint}>Align QR code within the frame</Text>
          {scanned && (
            <TouchableOpacity style={styles.rescanBtn} onPress={() => setScanned(false)}>
              <Text style={styles.rescanText}>Tap to scan again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex:1, backgroundColor:'#000' },
  overlay:        { ...StyleSheet.absoluteFillObject, flexDirection:'column' },
  overlayTop:     { flex:1, backgroundColor:'rgba(0,0,0,0.72)' },
  overlayMiddle:  { flexDirection:'row', height:FRAME },
  overlaySide:    { flex:1, backgroundColor:'rgba(0,0,0,0.72)' },
  overlayBottom:  { flex:1.2, backgroundColor:'rgba(0,0,0,0.72)', alignItems:'center', paddingTop:spacing.xl },
  scanFrame:      { width:FRAME, height:FRAME, position:'relative' },
  corner:         { position:'absolute', width:24, height:24, borderColor:colors.teal, borderWidth:3 },
  scanLine:       { position:'absolute', top:'50%', left:10, right:10, height:2,
                    backgroundColor:colors.teal, opacity:0.8 },
  scanHint:       { ...typography.body, color:'rgba(255,255,255,0.7)', textAlign:'center' },
  rescanBtn:      { marginTop:spacing.lg, paddingHorizontal:24, paddingVertical:10,
                    backgroundColor:colors.tealBg, borderRadius:radius.lg, borderWidth:1, borderColor:colors.teal },
  rescanText:     { ...typography.sm, color:colors.teal, fontWeight:'700' },
  cancelBtn:      { marginTop:spacing.lg },
  cancelText:     { ...typography.body, color:'rgba(255,255,255,0.6)' },
  permissionBox:  { flex:1, alignItems:'center', justifyContent:'center', padding:spacing.xxxl },
  permTitle:      { ...typography.h3, color:colors.text, marginBottom:spacing.sm },
  permText:       { ...typography.body, color:colors.textSecondary, textAlign:'center', marginBottom:spacing.xl },
  permBtn:        { backgroundColor:colors.tealBg, borderRadius:radius.lg, paddingHorizontal:32,
                    paddingVertical:14, borderWidth:1, borderColor:colors.teal },
  permBtnText:    { ...typography.body, color:colors.teal, fontWeight:'700' },
});
