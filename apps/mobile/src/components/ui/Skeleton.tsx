import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle, StyleSheet } from 'react-native';
import { colors, radius } from '../../theme';

export function Skeleton({ width, height, style, circle=false }: { width:number|string; height:number; style?:ViewStyle; circle?:boolean }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue:0.8, duration:700, useNativeDriver:true }),
        Animated.timing(opacity, { toValue:0.4, duration:700, useNativeDriver:true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View style={[
      { width:width as any, height, backgroundColor:colors.surfaceHigh,
        borderRadius: circle ? height/2 : radius.md, opacity },
      style,
    ]} />
  );
}
