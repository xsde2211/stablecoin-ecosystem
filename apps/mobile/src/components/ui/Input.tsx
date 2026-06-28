import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

interface Props extends TextInputProps {
  label?:      string;
  hint?:       string;
  error?:      string;
  rightIcon?:  React.ReactNode;
}

export function Input({ label, hint, error, rightIcon, style, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[
        styles.wrap,
        focused && styles.wrapFocused,
        error   && styles.wrapError,
      ]}>
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={colors.textTertiary}
          onFocus={() => setFocused(true)}
          onBlur={()  => setFocused(false)}
          selectionColor={colors.teal}
          {...props}
        />
        {rightIcon && <View style={styles.right}>{rightIcon}</View>}
      </View>
      {(error || hint) && (
        <Text style={[styles.hint, error && styles.hintError]}>{error ?? hint}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { marginBottom:spacing.md },
  label:       { ...typography.sm, color:colors.textSecondary, fontWeight:'600', marginBottom:6 },
  wrap:        { flexDirection:'row', alignItems:'center', backgroundColor:colors.surface,
                 borderRadius:radius.lg, borderWidth:1, borderColor:colors.border, paddingHorizontal:spacing.md },
  wrapFocused: { borderColor:colors.teal, backgroundColor:colors.bgTertiary },
  wrapError:   { borderColor:colors.error },
  input:       { flex:1, ...typography.body, color:colors.text, paddingVertical:15, minHeight:52 },
  right:       { paddingLeft:spacing.sm },
  hint:        { ...typography.xs, color:colors.textTertiary, marginTop:4, marginLeft:2 },
  hintError:   { color:colors.error },
});
