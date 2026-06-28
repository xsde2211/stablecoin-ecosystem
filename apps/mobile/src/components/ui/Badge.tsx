import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, typography } from '../../theme';

type Variant = 'teal'|'success'|'warning'|'error'|'info'|'default';

const VARIANT_STYLES: Record<Variant, { bg:string; color:string }> = {
  teal:    { bg:colors.tealBg2,    color:colors.teal    },
  success: { bg:colors.successBg,  color:colors.success  },
  warning: { bg:colors.warningBg,  color:colors.warning  },
  error:   { bg:colors.errorBg,    color:colors.error    },
  info:    { bg:colors.infoBg,     color:colors.info     },
  default: { bg:colors.surface,    color:colors.textSecondary },
};

export function Badge({ label, variant='default', dot=false }: { label:string; variant?:Variant; dot?:boolean }) {
  const s = VARIANT_STYLES[variant];
  return (
    <View style={[styles.badge, { backgroundColor:s.bg }]}>
      {dot && <View style={[styles.dot, { backgroundColor:s.color }]} />}
      <Text style={[styles.text, { color:s.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection:'row', alignItems:'center', gap:4,
           paddingHorizontal:8, paddingVertical:3, borderRadius:radius.full },
  dot:   { width:5, height:5, borderRadius:3 },
  text:  { ...typography.xs, fontWeight:'600' },
});
