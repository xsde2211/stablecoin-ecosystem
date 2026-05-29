import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../../theme';

interface Props {
  children:  React.ReactNode;
  style?:    ViewStyle;
  padding?:  number;
  variant?:  'default' | 'bordered' | 'elevated';
}

export function Card({ children, style, padding = spacing.lg, variant = 'default' }: Props) {
  return (
    <View style={[
      styles.base,
      { padding, borderRadius: radius.xl },
      variant === 'bordered'  && styles.bordered,
      variant === 'elevated'  && styles.elevated,
      style,
    ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base:     { backgroundColor: colors.surface },
  bordered: { borderWidth:1, borderColor:colors.border },
  elevated: { shadowColor:'#000', shadowOffset:{width:0,height:8}, shadowOpacity:0.3, shadowRadius:16, elevation:8 },
});
