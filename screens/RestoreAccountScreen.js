import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../lib/AuthContext';
import { useTheme } from '../lib/ThemeContext';
import AppIcon from '../components/AppIcon';
import { appTypography } from '../lib/darkThemeConfig';

function formatDeletedOn(deletedAt) {
  if (!deletedAt) return null;
  try {
    const d = new Date(deletedAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch (_) {
    return null;
  }
}

function daysLeft(deletedAt) {
  if (!deletedAt) return 7;
  try {
    const start = new Date(deletedAt).getTime();
    if (Number.isNaN(start)) return 7;
    const ends = start + 7 * 24 * 60 * 60 * 1000;
    const left = Math.ceil((ends - Date.now()) / (24 * 60 * 60 * 1000));
    return Math.max(0, left);
  } catch (_) {
    return 7;
  }
}

/**
 * Shown when a soft-deleted student signs in during the 7-day grace window.
 * No MainTabs access until they restore (or sign out).
 */
export default function RestoreAccountScreen() {
  const insets = useSafeAreaInsets();
  const { colors, isDarkMode } = useTheme();
  const { profile, user, restoreOwnAccount, signOut, authError, setAuthError } = useAuth();
  const [busy, setBusy] = useState(false);

  const deletedOnLabel = useMemo(
    () => formatDeletedOn(profile?.deleted_at),
    [profile?.deleted_at]
  );
  const remaining = useMemo(() => daysLeft(profile?.deleted_at), [profile?.deleted_at]);

  const handleRestore = async () => {
    setBusy(true);
    setAuthError?.(null);
    try {
      const { error } = await restoreOwnAccount();
      if (error) {
        Alert.alert('Restore failed', error.message || 'Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Sign out without restoring your account?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.contentBackground,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      <View style={styles.hero}>
        <View style={[styles.iconWrap, { backgroundColor: colors.mutedRowBackground }]}>
          <AppIcon name="warning-outline" size={36} color={colors.warning || '#F59E0B'} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>Account scheduled for deletion</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {deletedOnLabel
            ? `Your account was deleted on ${deletedOnLabel}.`
            : 'Your account is scheduled for deletion.'}{' '}
          You can restore it within 7 days
          {remaining > 0 ? ` (${remaining} day${remaining === 1 ? '' : 's'} left)` : ''}. After that,
          login will be permanently removed. Order history for the canteen is retained.
        </Text>
        {user?.email ? (
          <Text style={[styles.email, { color: colors.textTertiary }]}>{user.email}</Text>
        ) : null}
        {authError ? (
          <Text style={[styles.error, { color: colors.error || '#EF4444' }]}>{authError}</Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          onPress={handleRestore}
          disabled={busy}
          activeOpacity={0.88}
          style={styles.restoreTouchable}
        >
          <LinearGradient
            colors={['#34D399', '#059669']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.restoreGradient}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <AppIcon name="refresh-outline" size={22} color="#FFFFFF" style={styles.btnIcon} />
                <Text style={styles.restoreLabel}>Restore account</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSignOut}
          disabled={busy}
          style={[styles.signOutBtn, { borderColor: colors.border }]}
          activeOpacity={0.7}
        >
          <Text style={[styles.signOutLabel, { color: colors.textSecondary }]}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: appTypography.bold || appTypography.semiBold || appTypography.regular,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontFamily: appTypography.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  email: {
    fontFamily: appTypography.regular,
    fontSize: 13,
    marginTop: 16,
  },
  error: {
    fontFamily: appTypography.regular,
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
  },
  restoreTouchable: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  restoreGradient: {
    minHeight: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  btnIcon: {
    marginRight: 8,
  },
  restoreLabel: {
    fontFamily: appTypography.semiBold || appTypography.regular,
    fontSize: 16,
    color: '#FFFFFF',
  },
  signOutBtn: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutLabel: {
    fontFamily: appTypography.regular,
    fontSize: 15,
  },
});
