import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  Share,
} from 'react-native';
import LegalitiesCard from '../components/LegalitiesCard';
import HomeStyleToggle from '../components/HomeStyleToggle';
import { LinearGradient } from 'expo-linear-gradient';
import AppIcon from '../components/AppIcon';
import BrandYellowStrip from '../components/BrandYellowStrip';
import { pullRefreshControlProps } from '../lib/pullToRefresh';
import { useAuth } from '../lib/AuthContext';
import {
  getNotificationsEnabled,
  setNotificationsEnabled as persistNotificationsEnabled,
  getVegMode,
  setVegMode,
} from '../lib/settingsCache';
import { useTheme } from '../lib/ThemeContext';
import { supabase } from '../lib/supabase';
import { registerForPushNotificationsAsync } from '../lib/services/notifications';
import NotificationService from '../lib/NotificationService';
import { GlassCard } from '../components/ModernComponents';
import { appTypography } from '../lib/darkThemeConfig';

const fetchUserVegModeEnabled = async () => null;
const updateUserVegModeEnabled = async () => ({ ok: true, error: null });

const SOCIAL_LINKS = {
  instagram: 'https://www.instagram.com/hungertap.iare/',
};

/** Invite landing — Play Store + App Store ([scanme.hungertap.online](https://scanme.hungertap.online)). */
const APP_SHARE_URL = 'https://scanme.hungertap.online';
const APP_SHARE_MESSAGE =
  `HungerTap — Campus Food, Made Easy!\n` +
  `Exclusive to colleges, Hungertap makes ordering food faster and simpler.\n` +
  `Skip the crowds, avoid long queues, and enjoy a smoother campus experience.\n` +
  `Tap, order, and eat — Hungertap keeps your campus cravings hassle-free!\n\n` +
  `Get the app:\n${APP_SHARE_URL}`;

async function openExternalUrl(url) {
  try {
    await Linking.openURL(url);
  } catch (e) {
    Alert.alert('Cannot open link', 'This link could not be opened. Please try again.');
  }
}

function ProfileRow({
  icon,
  title,
  subtitle,
  onPress,
  right,
  colors,
  isLast,
}) {
  const content = (
    <>
      <View style={[styles.iconPill, { backgroundColor: colors.mutedRowBackground }]}>
        <AppIcon name={icon} size={22} color={colors.textSecondary} />
      </View>
      <View style={styles.rowTextBlock}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? (
        <View style={styles.rowRightSlot}>{right}</View>
      ) : (
        <AppIcon name="chevron-forward" size={20} color={colors.textTertiary} />
      )}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.row, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
        onPress={onPress}
        activeOpacity={0.65}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={[styles.row, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
    >
      {content}
    </View>
  );
}

const ProfileScreen = ({ navigation }) => {
  const { colors, isDarkMode, toggleTheme } = useTheme();
  const { user, userId, signOut, softDeleteOwnAccount } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(true);
  const [notifToggleBusy, setNotifToggleBusy] = React.useState(false);
  const [vegModeEnabled, setVegModeEnabled] = React.useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = React.useState(false);
  const [deletePassword, setDeletePassword] = React.useState('');
  const [deletePasswordVisible, setDeletePasswordVisible] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);

  const effectiveUserId = userId ?? user?.id ?? null;

  const displayName = React.useMemo(() => {
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    if (user?.user_metadata?.first_name || user?.user_metadata?.last_name) {
      return `${user?.user_metadata?.first_name || ''} ${user?.user_metadata?.last_name || ''}`.trim();
    }
    if (user?.email) {
      return user.email.split('@')[0];
    }
    return 'User';
  }, [user]);

  React.useEffect(() => {
    (async () => {
      try {
        setNotificationsEnabled(await getNotificationsEnabled());
      } catch (e) {
        console.error('Error loading settings:', e);
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        if (user?.id) {
          const fromBackend = await fetchUserVegModeEnabled(user.id);
          if (fromBackend !== null) {
            setVegModeEnabled(fromBackend);
            await setVegMode(fromBackend);
          } else {
            setVegModeEnabled(await getVegMode());
          }
        } else {
          setVegModeEnabled(await getVegMode());
        }
      } catch (e) {
        console.error('Error loading veg settings:', e);
      }
    })();
  }, [user?.id]);

  React.useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      try {
        if (user?.id) {
          const fromBackend = await fetchUserVegModeEnabled(user.id);
          if (fromBackend !== null) {
            setVegModeEnabled(fromBackend);
            await setVegMode(fromBackend);
            return;
          }
        }
        setVegModeEnabled(await getVegMode());
      } catch (e) {}
    });
    return unsubscribe;
  }, [navigation, user?.id]);

  const onToggleNotifications = async (value) => {
    if (notifToggleBusy) return;

    if (value === true && !effectiveUserId) {
      Alert.alert('Notifications', 'Sign in to enable push notifications for your orders.');
      return;
    }

    const previous = notificationsEnabled;
    setNotificationsEnabled(value);
    setNotifToggleBusy(true);
    try {
      if (value === true) {
        const { token, reason, localOnly } = await registerForPushNotificationsAsync(effectiveUserId);

        // Expo Go: remote push unavailable — still enable in-app local notifications.
        if (!token && reason === 'expo_go' && localOnly) {
          await persistNotificationsEnabled(true);
          await NotificationService.initialize();
          return;
        }

        if (!token) {
          setNotificationsEnabled(previous);
          if (reason === 'permission_denied') {
            Alert.alert(
              'Notifications are off',
              'To get order updates, allow notifications for HungerTap. Open Settings → Apps → HungerTap → Notifications, then turn them on.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => Linking.openSettings().catch(() => {}),
                },
              ]
            );
            return;
          }
          if (reason === 'simulator') {
            Alert.alert(
              'Physical device needed',
              'Push notifications only work on a real phone, not in the simulator or emulator.'
            );
            return;
          }
          if (reason === 'no_project_id') {
            Alert.alert(
              'Configuration',
              'Push setup is incomplete (missing Firebase / EAS project config). Rebuild the app with google-services.json and a valid EAS project.'
            );
            return;
          }
          if (reason === 'save_failed') {
            Alert.alert(
              'Could not save',
              'Notifications were allowed, but saving your device token failed. Check your connection and try again.'
            );
            return;
          }
          Alert.alert(
            'Could not enable notifications',
            reason === 'token_failed'
              ? 'Could not get a push token from this device. Try again, or restart the app after allowing notifications in system settings.'
              : 'Please use a physical device, allow notifications in system settings, and try again.'
          );
          return;
        }

        await persistNotificationsEnabled(true);
        // Allow NotificationService to finish channel/permission setup after preference is on.
        NotificationService.isInitialized = false;
        await NotificationService.initialize();
        return;
      } else if (effectiveUserId) {
        const { error } = await supabase
          .from('user_tokens')
          .update({ is_enabled: false })
          .eq('user_id', effectiveUserId);
        if (error) {
          setNotificationsEnabled(previous);
          Alert.alert('Notifications', 'Could not save your preference. Please try again.');
          return;
        }
        await NotificationService.clearAllNotifications();
      } else {
        await NotificationService.clearAllNotifications();
      }
      await persistNotificationsEnabled(value);
      if (value === false) {
        NotificationService.isInitialized = false;
      }
    } catch (e) {
      setNotificationsEnabled(previous);
      console.error('Error toggling notifications:', e);
      Alert.alert('Notifications', 'Something went wrong. Please try again.');
    } finally {
      setNotifToggleBusy(false);
    }
  };

  const onToggleVegMode = async (value) => {
    try {
      setVegModeEnabled(value);
      await setVegMode(value);
      if (user?.id) {
        const { ok, error } = await updateUserVegModeEnabled(user.id, value);
        if (!ok && error) console.warn('Veg mode backend:', error.message);
      }
    } catch (e) {}
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const openDeleteModal = () => {
    setDeletePassword('');
    setDeletePasswordVisible(false);
    setDeleteError('');
    setDeleteModalVisible(true);
  };

  const closeDeleteModal = () => {
    if (deleteBusy) return;
    setDeleteModalVisible(false);
    setDeletePassword('');
    setDeletePasswordVisible(false);
    setDeleteError('');
  };

  const handleConfirmDelete = async () => {
    const pwd = String(deletePassword || '');
    if (!pwd) {
      setDeleteError('Enter your password to continue.');
      return;
    }
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const { error } = await softDeleteOwnAccount(pwd);
      if (error) {
        const message = error.message || 'Could not delete account.';
        setDeleteError(message);
        if (error.code === 'active_orders') {
          Alert.alert('Active orders', message);
        }
        return;
      }
      setDeleteModalVisible(false);
      Alert.alert(
        'Account scheduled for deletion',
        'Your account will be permanently removed from login after 7 days. Sign in again within that window if you want to restore it.'
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleShareApp = async () => {
    try {
      // Android ignores Share `url` — put the link in `message` so WhatsApp/etc. get a tappable URL.
      await Share.share(
        Platform.select({
          ios: {
            message: APP_SHARE_MESSAGE,
            url: APP_SHARE_URL,
            title: 'HungerTap',
          },
          default: {
            message: APP_SHARE_MESSAGE,
            title: 'HungerTap',
          },
        })
      );
    } catch (error) {
      console.log('Error sharing:', error);
    }
  };

  const initial = displayName.charAt(0).toUpperCase();
  const emailDisplay = user?.email || '—';

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      setNotificationsEnabled(await getNotificationsEnabled());
      if (user?.id) {
        const fromBackend = await fetchUserVegModeEnabled(user.id);
        if (fromBackend !== null) {
          setVegModeEnabled(fromBackend);
          await setVegMode(fromBackend);
        } else {
          setVegModeEnabled(await getVegMode());
        }
      } else {
        setVegModeEnabled(await getVegMode());
      }
    } catch (_) {
      /* keep current values */
    } finally {
      setRefreshing(false);
    }
  }, [user?.id]);

  return (
    <View style={[styles.root, { backgroundColor: colors.contentBackground }]}>
      <BrandYellowStrip barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      <View style={[styles.header, { backgroundColor: colors.elevatedSurface }]}>
        <View style={styles.headerSide}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <AppIcon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          Profile
        </Text>
        <View style={styles.headerSide} />
      </View>

      <View style={[styles.headerSeparator, { backgroundColor: colors.border }]} />

      <View style={styles.body}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'never' : 'automatic'}
        automaticallyAdjustContentInsets={false}
        refreshControl={
          <RefreshControl
            {...pullRefreshControlProps({
              refreshing,
              onRefresh,
              tintColor: colors.primary,
              progressOffset: 0,
              androidBackgroundColor: colors.elevatedSurface,
            })}
          />
        }
      >
        {/* Name card */}
        <View
          style={[
            styles.nameCard,
            {
              borderColor: colors.brandYellow,
              borderTopColor: colors.brandYellow,
              borderTopWidth: 4,
              backgroundColor: colors.elevatedSurface,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <View style={styles.nameCardBody}>
            <LinearGradient
              colors={[colors.brandYellow, '#D4A017']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.nameAvatarRing}
            >
              <View style={[styles.nameAvatarInner, { backgroundColor: colors.elevatedSurface }]}>
                <Text style={[styles.nameAvatarLetter, { color: colors.text }]}>{initial}</Text>
              </View>
            </LinearGradient>

            <Text style={[styles.nameTitle, { color: colors.text }]} numberOfLines={2}>
              {displayName}
            </Text>

            <View style={styles.nameEmailRow}>
              <AppIcon name="mail-outline" size={16} color={colors.textSecondary} style={styles.nameEmailIcon} />
              <Text
                style={[styles.nameEmailText, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {emailDisplay}
              </Text>
            </View>
          </View>
        </View>

        {/* Preferences */}
        <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Preferences</Text>
        <GlassCard style={[styles.card, { borderColor: colors.border, backgroundColor: colors.elevatedSurface }]}>
          <ProfileRow
            icon="moon-outline"
            title="Dark mode"
            subtitle="Easier reading at night"
            colors={colors}
            right={
              <View style={styles.switchWrapper}>
                <HomeStyleToggle
                  value={isDarkMode}
                  onValueChange={toggleTheme}
                  activeColor={colors.brandYellow || '#F5B041'}
                />
              </View>
            }
          />
          <ProfileRow
            icon="notifications-outline"
            title="Notifications"
            subtitle="Order updates & alerts"
            colors={colors}
            right={
              <View style={styles.switchWrapper}>
                <HomeStyleToggle
                  value={notificationsEnabled}
                  onValueChange={onToggleNotifications}
                  disabled={notifToggleBusy}
                  activeColor={colors.brandYellow || '#F5B041'}
                />
              </View>
            }
          />
          <ProfileRow
            icon="leaf-outline"
            title="Veg mode"
            subtitle="Highlight vegetarian items on the menu"
            colors={colors}
            isLast
            right={
              <View style={styles.switchWrapper}>
                <HomeStyleToggle
                  value={vegModeEnabled}
                  onValueChange={onToggleVegMode}
                  activeColor="#00C137"
                />
              </View>
            }
          />
        </GlassCard>

        <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Follow us</Text>
        <GlassCard style={[styles.card, { borderColor: colors.border, backgroundColor: colors.elevatedSurface }]}>
          <ProfileRow
            icon="logo-instagram"
            title="Instagram"
            subtitle="hungertap.iare"
            colors={colors}
            isLast
            onPress={() => openExternalUrl(SOCIAL_LINKS.instagram)}
          />
        </GlassCard>

        <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Legalities</Text>
        <LegalitiesCard colors={colors} style={styles.card} />

        {/* More */}
        <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>More</Text>
        <GlassCard style={[styles.card, { borderColor: colors.border, backgroundColor: colors.elevatedSurface }]}>
          <ProfileRow
            icon="key-outline"
            title="Change password"
            subtitle="Verify your email and set a new password"
            colors={colors}
            onPress={() => {
              const accountEmail = user?.email || '';
              if (!accountEmail) {
                Alert.alert('Change password', 'No email is linked to your account.');
                return;
              }
              navigation.navigate('ForgotPassword', {
                email: accountEmail,
                changePassword: true,
              });
            }}
          />
          <ProfileRow
            icon="receipt-outline"
            title="Order history"
            subtitle="Past and active orders"
            colors={colors}
            onPress={() => navigation.navigate('Orders')}
          />
          <ProfileRow
            icon="chatbubble-ellipses-outline"
            title="Feedback"
            subtitle="Tell us what you think"
            colors={colors}
            onPress={() => navigation.navigate('Feedback')}
          />
          <ProfileRow
            icon="mail-outline"
            title="Contact us"
            subtitle="Reach our team"
            colors={colors}
            onPress={() => navigation.navigate('ContactUs')}
          />
          <ProfileRow
            icon="share-social-outline"
            title="Share with friends"
            subtitle="Invite others to HungerTap"
            colors={colors}
            onPress={handleShareApp}
          />
          <ProfileRow
            icon="trash-outline"
            title="Delete account"
            subtitle="Schedule permanent deletion (7-day restore)"
            colors={colors}
            isLast
            onPress={openDeleteModal}
          />
        </GlassCard>

        <View style={styles.signOutInSection}>
          <TouchableOpacity
            onPress={handleSignOut}
            activeOpacity={0.88}
            style={styles.signOutTouchable}
          >
            <LinearGradient
              colors={['#FF5C5C', '#DC2626', '#B91C1C']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.signOutGradient}
            >
              <AppIcon name="log-out-outline" size={22} color="#FFFFFF" style={styles.signOutIcon} />
              <Text style={styles.signOutLabel}>Sign out</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </View>

      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.deleteModalOverlay}
        >
          <Pressable style={styles.deleteModalBackdrop} onPress={closeDeleteModal} />
          <View style={[styles.deleteModalCard, { backgroundColor: colors.elevatedSurface, borderColor: colors.border }]}>
            <Text style={[styles.deleteModalTitle, { color: colors.text }]}>Delete your account?</Text>
            <Text style={[styles.deleteModalBody, { color: colors.textSecondary }]}>
              Your data will be scheduled for complete deletion. You can restore the account within 7
              days by signing in again. After 7 days, login access is permanently removed; canteen
              order history is retained.
            </Text>
            <Text style={[styles.deleteModalHint, { color: colors.textTertiary }]}>
              Enter your password to confirm
            </Text>
            <View
              style={[
                styles.deletePasswordRow,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.mutedRowBackground || colors.contentBackground,
                },
              ]}
            >
              <TextInput
                value={deletePassword}
                onChangeText={setDeletePassword}
                placeholder="Password"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!deletePasswordVisible}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!deleteBusy}
                style={[styles.deletePasswordInput, { color: colors.text }]}
              />
              <TouchableOpacity
                onPress={() => setDeletePasswordVisible((v) => !v)}
                style={styles.deletePasswordToggle}
                disabled={deleteBusy}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={deletePasswordVisible ? 'Hide password' : 'Show password'}
              >
                <AppIcon
                  name={deletePasswordVisible ? 'eye' : 'eye-off'}
                  size={20}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>
            </View>
            {deleteError ? (
              <Text style={[styles.deleteError, { color: colors.error || '#EF4444' }]}>
                {deleteError}
              </Text>
            ) : null}
            <View style={styles.deleteModalActions}>
              <TouchableOpacity
                onPress={closeDeleteModal}
                disabled={deleteBusy}
                style={[styles.deleteCancelBtn, { borderColor: colors.border }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.deleteCancelLabel, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmDelete}
                disabled={deleteBusy}
                activeOpacity={0.88}
                style={styles.deleteConfirmTouchable}
              >
                <LinearGradient
                  colors={['#FF5C5C', '#B91C1C']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.deleteConfirmGradient}
                >
                  {deleteBusy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.deleteConfirmLabel}>Delete account</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  strip: {
    height: 34,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerSide: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontFamily: appTypography.bold,
  },
  headerSeparator: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  body: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  signOutInSection: {
    marginTop: 8,
    marginBottom: 0,
  },
  signOutTouchable: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  signOutGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
  },
  signOutIcon: {
    marginRight: 10,
  },
  signOutLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: appTypography.bold,
    letterSpacing: 0.4,
  },
  nameCard: {
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 20,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 5,
  },
  nameCardBody: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
  },
  nameAvatarRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  nameAvatarInner: {
    width: 74,
    height: 74,
    borderRadius: 37,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameAvatarLetter: {
    fontSize: 32,
    fontFamily: appTypography.bold,
  },
  nameTitle: {
    fontSize: 22,
    fontFamily: appTypography.bold,
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  nameEmailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
    paddingHorizontal: 8,
  },
  nameEmailIcon: {
    marginRight: 6,
  },
  nameEmailText: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: appTypography.regular,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: appTypography.semiBold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: 16,
    marginBottom: 18,
    borderWidth: 1,
    overflow: 'hidden',
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  iconPill: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rowTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 16,
    fontFamily: appTypography.semiBold,
  },
  rowSubtitle: {
    fontSize: 13,
    fontFamily: appTypography.regular,
    marginTop: 2,
    lineHeight: 18,
  },
  rowRightSlot: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    minWidth: 52,
    marginLeft: 8,
  },
  switchWrapper: {
    height: 31,
    justifyContent: 'center',
    alignItems: 'center',
  },
  switchControl: {
    transform: Platform.OS === 'ios' ? [{ scaleX: 0.85 }, { scaleY: 0.85 }] : [],
  },
  deleteModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  deleteModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  deleteModalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    zIndex: 1,
  },
  deleteModalTitle: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    marginBottom: 10,
  },
  deleteModalBody: {
    fontSize: 14,
    fontFamily: appTypography.regular,
    lineHeight: 20,
    marginBottom: 16,
  },
  deleteModalHint: {
    fontSize: 12,
    fontFamily: appTypography.semiBold,
    marginBottom: 8,
  },
  deletePasswordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  deletePasswordInput: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 15,
    fontFamily: appTypography.regular,
  },
  deletePasswordToggle: {
    padding: 4,
    marginLeft: 4,
  },
  deleteError: {
    fontSize: 13,
    fontFamily: appTypography.regular,
    marginBottom: 8,
  },
  deleteModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  deleteCancelBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCancelLabel: {
    fontSize: 15,
    fontFamily: appTypography.semiBold,
  },
  deleteConfirmTouchable: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  deleteConfirmGradient: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  deleteConfirmLabel: {
    fontSize: 15,
    fontFamily: appTypography.semiBold,
    color: '#FFFFFF',
  },
});

export default ProfileScreen;

