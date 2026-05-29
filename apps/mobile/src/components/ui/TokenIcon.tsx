import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius } from '../../theme';

const TOKEN: Record<string,{symbol:string;bg:string;color:string}> = {
  INRX:  { symbol:'₹',  bg:colors.tealBg,   color:colors.teal   },
  EGOLD: { symbol:'Au', bg:colors.goldBg,   color:colors.gold   },
  ESLVR: { symbol:'Ag', bg:colors.silverBg, color:colors.silver },
};

export function TokenIcon({ token, size=44 }: { token:string; size?:number }) {
  const cfg = TOKEN[token] ?? { symbol:token[0], bg:colors.surface, color:colors.text };
  return (
    <View style={{ width:size, height:size, borderRadius:size/2,
                   backgroundColor:cfg.bg, alignItems:'center', justifyContent:'center' }}>
      <Text style={{ color:cfg.color, fontSize:size*0.36, fontWeight:'700' }}>{cfg.symbol}</Text>
    </View>
  );
}
