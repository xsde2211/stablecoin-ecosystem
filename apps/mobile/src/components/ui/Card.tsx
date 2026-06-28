import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../../theme';

interface Props {
  children: React.ReactNode;
  style?:   ViewStyle;
  padding?: number;
  variant?: 'default' | 'bordered' | 'glow';
  glowColor?: string;
}

export function Card({ children, style, padding=spacing.lg, variant='bordered', glowColor=colors.teal }: Props) {
  return (
    <View style={[
      styles.base,
      { padding, borderRadius:radius.xl },
      variant === 'bordered' && styles.bordered,
      variant === 'glow'     && { ...styles.bordered, borderColor: glowColor+'40',
        shadowColor:glowColor, shadowOffset:{width:0,height:0}, shadowOpacity:0.15, shadowRadius:12, elevation:4 },
      style,
    ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base:     { backgroundColor:colors.surface },
  bordered: { borderWidth:1, borderColor:colors.border },
});
