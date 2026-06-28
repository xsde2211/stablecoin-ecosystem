import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';

export type ToastType = 'success' | 'error' | 'info';

interface Props { message:string; type:ToastType; visible:boolean; onHide:()=>void; }

const ICONS: Record<ToastType, any> = { success:'checkmark-circle', error:'close-circle', info:'information-circle' };
const COLORS: Record<ToastType, string> = { success:colors.success, error:colors.error, info:colors.info };

export function Toast({ message, type, visible, onHide }: Props) {
  const translateY = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, { toValue:0, useNativeDriver:true, damping:15 }).start();
      const timer = setTimeout(() => {
        Animated.timing(translateY, { toValue:-100, duration:250, useNativeDriver:true }).start(onHide);
      }, 2800);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, { transform:[{translateY}] }]}>
      <View style={[styles.iconWrap, { backgroundColor: COLORS[type]+'20' }]}>
        <Ionicons name={ICONS[type]} size={18} color={COLORS[type]} />
      </View>
      <Text style={styles.text} numberOfLines={2}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { position:'absolute', top:56, left:spacing.lg, right:spacing.lg,
               flexDirection:'row', alignItems:'center', gap:spacing.sm,
               backgroundColor:colors.surfaceHigh, borderRadius:radius.lg,
               borderWidth:1, borderColor:colors.border, padding:spacing.md, zIndex:1000,
               shadowColor:'#000', shadowOffset:{width:0,height:4}, shadowOpacity:0.4, shadowRadius:12, elevation:10 },
  iconWrap:  { width:32, height:32, borderRadius:16, alignItems:'center', justifyContent:'center' },
  text:      { ...typography.sm, color:colors.text, flex:1, fontWeight:'500' },
});
