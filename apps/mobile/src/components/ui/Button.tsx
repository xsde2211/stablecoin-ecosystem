import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, typography, shadow } from '../../theme';

interface Props {
  label:      string;
  onPress:    () => void;
  variant?:   'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
  size?:      'sm' | 'md' | 'lg';
  loading?:   boolean;
  disabled?:  boolean;
  icon?:      React.ReactNode;
  fullWidth?: boolean;
}

export function Button({ label, onPress, variant='primary', size='md', loading, disabled, icon, fullWidth=true }: Props) {
  const height   = { sm:42, md:54, lg:62 }[size];
  const fontSize = { sm:13, md:15, lg:16 }[size];
  const isDisabled = disabled || loading;

  if (variant === 'primary') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.85}
        style={[{ width: fullWidth?'100%':undefined, height, opacity: isDisabled?0.45:1, borderRadius:radius.lg, overflow:'hidden' }, shadow.teal]}
      >
        <LinearGradient
          colors={[colors.teal, colors.tealDark]}
          start={{x:0,y:0}} end={{x:1,y:0}}
          style={[styles.base, { height }]}
        >
          {loading ? <ActivityIndicator color="#000" size="small" /> : (
            <View style={styles.row}>
              {icon && <View style={{marginRight:8}}>{icon}</View>}
              <Text style={[typography.h5, {color:'#000', fontSize, fontWeight:'700'}]}>{label}</Text>
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  if (variant === 'gold') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.85}
        style={[{ width:fullWidth?'100%':undefined, height, opacity:isDisabled?0.45:1, borderRadius:radius.lg, overflow:'hidden' }]}
      >
        <LinearGradient
          colors={[colors.gold, colors.goldDark]}
          start={{x:0,y:0}} end={{x:1,y:0}}
          style={[styles.base, {height}]}
        >
          {loading ? <ActivityIndicator color="#000" size="small" /> : (
            <Text style={[typography.h5, {color:'#000', fontSize}]}>{label}</Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  const bg = { secondary:colors.surface, ghost:'transparent', danger:colors.errorBg }[variant] ?? colors.surface;
  const tc = { secondary:colors.text,    ghost:colors.teal,   danger:colors.error   }[variant] ?? colors.text;
  const bc = { secondary:colors.border,  ghost:colors.tealBorder, danger:colors.error+'40' }[variant] ?? colors.border;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      style={[styles.base, { width:fullWidth?'100%':undefined, height, backgroundColor:bg,
              borderRadius:radius.lg, borderWidth:1, borderColor:bc, opacity:isDisabled?0.45:1,
              paddingHorizontal:fullWidth?0:24 }]}
    >
      {loading ? <ActivityIndicator color={tc} size="small" /> : (
        <View style={styles.row}>
          {icon && <View style={{marginRight:8}}>{icon}</View>}
          <Text style={[typography.h5, {color:tc, fontSize}]}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: { alignItems:'center', justifyContent:'center' },
  row:  { flexDirection:'row', alignItems:'center' },
});
