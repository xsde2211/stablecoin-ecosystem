import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, typography } from '../../theme';

type Variant = 'success'|'warning'|'error'|'info'|'teal'|'neutral';

const config: Record<Variant,{bg:string;text:string}> = {
  success: { bg:colors.successBg, text:colors.success },
  warning: { bg:colors.warningBg, text:colors.warning },
  error:   { bg:colors.errorBg,   text:colors.error   },
  info:    { bg:colors.infoBg,    text:colors.info     },
  teal:    { bg:colors.tealBg,    text:colors.teal     },
  neutral: { bg:colors.surface,   text:colors.textSecondary },
};

export function Badge({ label, variant='neutral' }: { label:string; variant?:Variant }) {
  const c = config[variant];
  return (
    <View style={[styles.base, { backgroundColor:c.bg }]}>
      <Text style={[styles.text, { color:c.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { paddingHorizontal:10, paddingVertical:3, borderRadius:radius.full, alignSelf:'flex-start' },
  text: { ...typography.xs, fontWeight:'600', letterSpacing:0.2 },
});
