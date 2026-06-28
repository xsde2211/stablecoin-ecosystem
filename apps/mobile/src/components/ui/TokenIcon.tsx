import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius } from '../../theme';

const TOKEN_CONFIG: Record<string, { symbol:string; color:string; bg:string }> = {
  INRX:  { symbol:'₹',  color:colors.teal,   bg:colors.tealBg   },
  EGOLD: { symbol:'Au', color:colors.gold,   bg:colors.goldBg   },
  ESLVR: { symbol:'Ag', color:colors.silver, bg:colors.silverBg },
};

export function TokenIcon({ token, size=40 }: { token:string; size?:number }) {
  const cfg = TOKEN_CONFIG[token] ?? { symbol:token[0], color:colors.textSecondary, bg:colors.surface };
  return (
    <View style={{ width:size, height:size, borderRadius:size/2,
                   backgroundColor:cfg.bg, alignItems:'center', justifyContent:'center',
                   borderWidth:1, borderColor:cfg.color+'40' }}>
      <Text style={{ fontSize:size*0.38, fontWeight:'700', color:cfg.color }}>{cfg.symbol}</Text>
    </View>
  );
}
