import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, TouchableOpacity, TextInputProps } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

interface Props extends TextInputProps {
  label?:       string;
  error?:       string;
  hint?:        string;
  rightIcon?:   React.ReactNode;
  leftIcon?:    React.ReactNode;
}

export function Input({ label, error, hint, rightIcon, leftIcon, style, ...props }: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[
        styles.container,
        focused && styles.focused,
        error   && styles.errored,
      ]}>
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          {...props}
          onFocus={(e) => { setFocused(true);  props.onFocus?.(e); }}
          onBlur ={(e) => { setFocused(false); props.onBlur?.(e);  }}
          style={[styles.input, !!leftIcon && { paddingLeft:0 }, style]}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.teal}
        />
        {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {hint  && !error && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:   { marginBottom: spacing.md },
  label:     { ...typography.sm, color:colors.textSecondary, marginBottom:6, fontWeight:'500' },
  container: { flexDirection:'row', alignItems:'center', backgroundColor:colors.bgTertiary,
               borderRadius:radius.lg, borderWidth:1, borderColor:colors.border, minHeight:52 },
  focused:   { borderColor:colors.teal },
  errored:   { borderColor:colors.error },
  input:     { flex:1, ...typography.body, color:colors.text, paddingHorizontal:spacing.lg, paddingVertical:14 },
  leftIcon:  { paddingLeft:spacing.lg },
  rightIcon: { paddingRight:spacing.lg },
  error:     { ...typography.xs, color:colors.error, marginTop:4 },
  hint:      { ...typography.xs, color:colors.textTertiary, marginTop:4 },
});
