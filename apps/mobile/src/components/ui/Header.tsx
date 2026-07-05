import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Platform, StatusBar,
} from 'react-native';
import { Ionicons }          from '@expo/vector-icons';
import { useNavigation }     from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, radius } from '../../theme';

interface Props {
  title:         string;
  subtitle?:     string;
  showBack?:     boolean;
  rightIcon?:    string;
  onRightPress?: () => void;
  rightLabel?:   string;
}

export function Header({
  title,
  subtitle,
  showBack = true,
  rightIcon,
  onRightPress,
  rightLabel,
}: Props) {
  const nav    = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const canGoBack = nav.canGoBack?.() ?? false;

  // The Header itself owns the status-bar / notch clearance.
  // Screens must NOT also add top inset via SafeAreaView edges,
  // otherwise the heading appears shifted down.
  const topPad = Platform.OS === 'ios'
    ? insets.top          // respects notch / Dynamic Island
    : StatusBar.currentHeight ?? 24;  // Android status bar

  return (
    <View style={[styles.wrap, { paddingTop: topPad + 6 }]}>
      <View style={styles.row}>
        {/* Left — back button */}
        <View style={styles.side}>
          {showBack && canGoBack ? (
            <TouchableOpacity
              onPress={() => nav.goBack()}
              style={styles.iconBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Center — title */}
        <View style={styles.center}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>

        {/* Right — action */}
        <View style={[styles.side, styles.sideRight]}>
          {rightIcon ? (
            <TouchableOpacity
              onPress={onRightPress}
              style={styles.iconBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
            >
              <Ionicons name={rightIcon as any} size={20} color={colors.text} />
            </TouchableOpacity>
          ) : rightLabel ? (
            <TouchableOpacity
              onPress={onRightPress}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.rightLabel}>{rightLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor:   colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom:     spacing.sm + 2,
  },
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: spacing.lg,
    minHeight:         44,
  },
  side:      { width: 44 },
  sideRight: { alignItems: 'flex-end' },
  center:    { flex: 1, alignItems: 'center' },
  iconBtn: {
    width:           40,
    height:          40,
    borderRadius:    radius.full,
    backgroundColor: colors.surface,
    borderWidth:     1,
    borderColor:     colors.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  title:      { ...typography.h4, color: colors.text },
  subtitle:   { ...typography.xs, color: colors.textSecondary, marginTop: 2 },
  rightLabel: { ...typography.sm, color: colors.teal, fontWeight: '600' as const },
});