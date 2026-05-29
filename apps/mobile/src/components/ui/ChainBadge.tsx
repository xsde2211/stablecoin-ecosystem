import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, typography } from '../../theme';

const CHAIN: Record<string,{label:string;color:string}> = {
  tron:     { label:'TRON',    color:colors.tron     },
  ethereum: { label:'ETH',     color:colors.ethereum },
  bsc:      { label:'BSC',     color:colors.bsc      },
  polygon:  { label:'MATIC',   color:colors.polygon  },
  solana:   { label:'SOL',     color:colors.solana   },
};

export function ChainBadge({ chain }: { chain:string }) {
  const c = CHAIN[chain] ?? { label:chain.toUpperCase(), color:colors.textSecondary };
  return (
    <View style={{ flexDirection:'row', alignItems:'center', gap:4 }}>
      <View style={{ width:7, height:7, borderRadius:4, backgroundColor:c.color }} />
      <Text style={[typography.xs, { color:c.color, fontWeight:'600' }]}>{c.label}</Text>
    </View>
  );
}
