import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { colors, radius, typography } from '../../theme';

interface Props {
  label:      string;
  onPress:    () => void;
  variant?:   'primary' | 'secondary' | 'ghost' | 'danger';
  size?:      'sm' | 'md' | 'lg';
  loading?:   boolean;
  disabled?:  boolean;
  icon?:      React.ReactNode;
  fullWidth?: boolean;
}

export function Button({ label, onPress, variant='primary', size='md', loading, disabled, icon, fullWidth=true }: Props) {
  const bg = {
    primary:   colors.teal,
    secondary: colors.surface,
    ghost:     'transparent',
    danger:    colors.error,
  }[variant];

  const textColor = {
    primary:   '#000',
    secondary: colors.text,
    ghost:     colors.teal,
    danger:    '#fff',
  }[variant];

  const height = { sm:40, md:52, lg:60 }[size];
  const fontSize = { sm:13, md:15, lg:16 }[size];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.82}
      style={[
        styles.base,
        { backgroundColor: bg, height, borderRadius: radius.lg,
          opacity: (disabled || loading) ? 0.5 : 1,
          width: fullWidth ? '100%' : undefined,
          paddingHorizontal: fullWidth ? 0 : 24,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colors.border,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <View style={styles.row}>
          {icon && <View style={{ marginRight: 8 }}>{icon}</View>}
          <Text style={[typography.body, { color: textColor, fontSize, fontWeight: '600' }]}>
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: { alignItems:'center', justifyContent:'center' },
  row:  { flexDirection:'row', alignItems:'center' },
});
