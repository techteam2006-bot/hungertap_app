import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  Share,
  Linking,
  Platform,
} from 'react-native';
import LegalitiesCard from '../components/LegalitiesCard';
import { LinearGradient } from 'expo-linear-gradient';
import AppIcon from '../components/AppIcon';
import BrandYellowStrip from '../components/BrandYellowStrip';
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
  twitter: 'https://twitter.com/HungerTap',
  facebook: 'https://www.facebook.com/profile.php?id=61563114927891',
};

/** Play Store listing for this app (`app.json` → android.package). */
const APP_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.hungertap.app';
const APP_SHARE_MESSAGE =
  `Check out the HungerTap App!\n\nDownload here:\n${APP_STORE_URL}`;

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
      {right ?? <AppIcon name="chevron-forward" size={20} color={colors.textTertiary} />}
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
  const { user, userId, signOut } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(true);
  const [notifToggleBusy, setNotifToggleBusy] = React.useState(false);
  const [vegModeEnabled, setVegModeEnabled] = React.useState(false);

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

  const switchTrack = { false: '#767577', true: colors.brandYellow };
  const switchThumb = '#FFFFFF';

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

  const handleShareApp = async () => {
    try {
      // Android ignores Share `url` — put the link in `message` so WhatsApp/etc. get a tappable URL.
      await Share.share(
        Platform.select({
          ios: {
            message: APP_SHARE_MESSAGE,
            url: APP_STORE_URL,
            title: 'HungerTap App',
          },
          default: {
            message: APP_SHARE_MESSAGE,
            title: 'HungerTap App',
          },
        })
      );
    } catch (error) {
      console.log('Error sharing:', error);
    }
  };

  const initial = displayName.charAt(0).toUpperCase();
  const emailDisplay = user?.email || '—';

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
      >
        {/* Name card */}
        <View
          style={[
            styles.nameCard,
            {
              borderColor: colors.brandYellow,
              backgroundColor: colors.elevatedSurface,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <View style={[styles.nameCardAccent, { backgroundColor: colors.brandYellow }]} />
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
              <Switch
                value={isDarkMode}
                onValueChange={toggleTheme}
                trackColor={switchTrack}
                thumbColor={switchThumb}
                ios_backgroundColor="#3e3e3e"
              />
            }
          />
          <ProfileRow
            icon="notifications-outline"
            title="Notifications"
            subtitle="Order updates & alerts"
            colors={colors}
            right={
              <Switch
                value={notificationsEnabled}
                onValueChange={onToggleNotifications}
                disabled={notifToggleBusy}
                trackColor={switchTrack}
                thumbColor={switchThumb}
                ios_backgroundColor="#3e3e3e"
              />
            }
          />
          <ProfileRow
            icon="leaf-outline"
            title="Veg mode"
            subtitle="Highlight vegetarian items on the menu"
            colors={colors}
            isLast
            right={
              <Switch
                value={vegModeEnabled}
                onValueChange={onToggleVegMode}
                trackColor={switchTrack}
                thumbColor={switchThumb}
                ios_backgroundColor="#3e3e3e"
              />
            }
          />
        </GlassCard>

        <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Follow us</Text>
        <GlassCard style={[styles.card, { borderColor: colors.border, backgroundColor: colors.elevatedSurface }]}>
          <ProfileRow
            icon="logo-instagram"
            title="Instagram"
            subtitle="hungertap"
            colors={colors}
            onPress={() => openExternalUrl(SOCIAL_LINKS.instagram)}
          />
          <ProfileRow
            icon="logo-twitter"
            title="Twitter"
            subtitle="@HungerTap"
            colors={colors}
            onPress={() => openExternalUrl(SOCIAL_LINKS.twitter)}
          />
          <ProfileRow
            icon="logo-facebook"
            title="Facebook"
            subtitle="HungerTap"
            colors={colors}
            isLast
            onPress={() => openExternalUrl(SOCIAL_LINKS.facebook)}
          />
        </GlassCard>

        <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Legalities</Text>
        <LegalitiesCard colors={colors} style={styles.card} />

        {/* More */}
        <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>More</Text>
        <GlassCard style={[styles.card, { borderColor: colors.border, backgroundColor: colors.elevatedSurface }]}>
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
            isLast
            onPress={handleShareApp}
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
  nameCardAccent: {
    height: 4,
    width: '100%',
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
});

export default ProfileScreen;
