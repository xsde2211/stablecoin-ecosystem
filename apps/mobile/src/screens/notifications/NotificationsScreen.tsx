import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons }     from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
import { Header }     from '../../components/ui/Header';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton }   from '../../components/ui/Skeleton';
import { colors, typography, spacing, radius } from '../../theme';
import { fetchNotifications, markAllRead } from '../../store/slices/notifSlice';
import type { AppDispatch, RootState } from '../../store';

const TYPE_ICON: Record<string, any> = {
  KYC_APPROVED: 'checkmark-circle',
  KYC_REJECTED: 'close-circle',
  SYSTEM:       'information-circle',
};
const TYPE_COLOR: Record<string, string> = {
  KYC_APPROVED: colors.success,
  KYC_REJECTED: colors.error,
  SYSTEM:       colors.info,
};

export default function NotificationsScreen() {
  const dispatch   = useDispatch<AppDispatch>();
  const { notifications, unread, loading } = useSelector((s: RootState) => s.notif);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { dispatch(fetchNotifications()); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await dispatch(fetchNotifications());
    setRefreshing(false);
  };

  const handleMarkAllRead = async () => {
    await dispatch(markAllRead());
    dispatch(fetchNotifications());
  };

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <Header
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : undefined}
        rightIcon={unread > 0 ? 'checkmark-done-outline' : undefined}
        onRightPress={handleMarkAllRead}
      />

      {loading ? (
        <View style={styles.skeletonWrap}>
          {[1, 2, 3, 4].map(i => <Skeleton key={i} width="100%" height={72} />)}
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />
          }
          ListEmptyComponent={
            <EmptyState icon="notifications-outline" title="No notifications" subtitle="You're all caught up" />
          }
          renderItem={({ item }) => (
            <View style={[styles.row, !item.read && styles.rowUnread]}>
              <View style={[styles.icon, { backgroundColor: (TYPE_COLOR[item.type] ?? colors.info) + '18' }]}>
                <Ionicons
                  name={TYPE_ICON[item.type] ?? 'information-circle'}
                  size={20}
                  color={TYPE_COLOR[item.type] ?? colors.info}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
                <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
              </View>
              {!item.read && <View style={styles.unreadDot} />}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: colors.bg },
  skeletonWrap:{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingTop: spacing.md },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowUnread:  { backgroundColor: colors.tealBg },
  icon:       { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  title:      { ...typography.h5, color: colors.text, marginBottom: 3 },
  body:       { ...typography.sm, color: colors.textSecondary, lineHeight: 18 },
  time:       { ...typography.xs, color: colors.textTertiary, marginTop: 4 },
  unreadDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal, marginTop: 6 },
});
