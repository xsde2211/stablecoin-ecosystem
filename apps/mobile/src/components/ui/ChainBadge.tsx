import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, typography } from '../../theme';

const CHAIN_COLOR: Record<string, string> = {
  tron:'#EF0027', ethereum:'#627EEA', bsc:'#F0B90B', polygon:'#8247E5', solana:'#9945FF',
};
const CHAIN_LABEL: Record<string, string> = {
  tron:'TRON', ethereum:'ETH', bsc:'BSC', polygon:'MATIC', solana:'SOL',
};

export function ChainBadge({ chain, size='sm' }: { chain:string; size?:'xs'|'sm' }) {
  const c = CHAIN_COLOR[chain] ?? colors.textSecondary;
  return (
    <View style={[styles.badge, { backgroundColor:c+'18', borderColor:c+'40' }]}>
      <View style={[styles.dot, { backgroundColor:c }]} />
      <Text style={[styles.text, { color:c, fontSize:size==='xs'?9:11 }]}>
        {CHAIN_LABEL[chain] ?? chain.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection:'row', alignItems:'center', gap:3,
           paddingHorizontal:6, paddingVertical:2, borderRadius:radius.full, borderWidth:1 },
  dot:   { width:4, height:4, borderRadius:2 },
  text:  { ...typography.xs, fontWeight:'700' },
});
