import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';

export function EmptyState({ icon='inbox-outline', title, subtitle }: { icon?:any; title:string; subtitle?:string }) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={32} color={colors.textTertiary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems:'center', paddingVertical:spacing.xxxxl, paddingHorizontal:spacing.xl },
  iconWrap:  { width:64, height:64, borderRadius:radius.xl, backgroundColor:colors.surface,
               alignItems:'center', justifyContent:'center', marginBottom:spacing.lg,
               borderWidth:1, borderColor:colors.border },
  title:     { ...typography.h4, color:colors.text, marginBottom:4, textAlign:'center' },
  subtitle:  { ...typography.sm, color:colors.textTertiary, textAlign:'center' },
});
