import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  BackHandler,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AppIcon from '../components/AppIcon';
import BrandYellowStrip from '../components/BrandYellowStrip';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';
import { PLAY_STORE_URL } from '../lib/appVersionCheck';

/**
 * Full-screen hard block — no dismiss, no skip, hardware back disabled.
 */
export default function ForceUpdateScreen({ installedVersion, minimumVersion }) {
  const { colors, isDarkMode } = useTheme();

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const openStore = useCallback(async () => {
    try {
      const canOpen = await Linking.canOpenURL(PLAY_STORE_URL);
      if (!canOpen) {
        Alert.alert('Update required', `Please update HungerTap from the Play Store:\n${PLAY_STORE_URL}`);
        return;
      }
      await Linking.openURL(PLAY_STORE_URL);
    } catch (_) {
      Alert.alert('Update required', `Please update HungerTap from the Play Store:\n${PLAY_STORE_URL}`);
    }
  }, []);

  const cardSurface = isDarkMode ? 'rgba(255, 255, 255, 0.07)' : colors.elevatedSurface;
  const cardOutline = isDarkMode ? colors.glassBorder : colors.border;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.contentBackground }]} edges={['bottom', 'left', 'right']}>
      <BrandYellowStrip />
      <View style={styles.body}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: cardSurface,
              borderColor: cardOutline,
              shadowColor: isDarkMode ? '#000000' : colors.shadow,
            },
          ]}
        >
          <LinearGradient
            colors={[colors.brandYellow, '#D4A017']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.cardAccent}
          />

          <View style={[styles.iconRing, { backgroundColor: colors.brandYellow + '22' }]}>
            <AppIcon name="information-circle-outline" size={36} color={colors.brandYellow} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Update required</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            A newer version of HungerTap is required to continue. Please update from the{' '}
            {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} to keep ordering safely.
          </Text>

          <View style={[styles.versionBox, { backgroundColor: colors.mutedRowBackground, borderColor: cardOutline }]}>
            <Text style={[styles.versionLine, { color: colors.textSecondary }]}>
              Installed: <Text style={{ color: colors.text, fontFamily: appTypography.semiBold }}>{installedVersion || '—'}</Text>
            </Text>
            <Text style={[styles.versionLine, { color: colors.textSecondary }]}>
              Required: <Text style={{ color: colors.text, fontFamily: appTypography.semiBold }}>{minimumVersion || '—'}</Text>
            </Text>
          </View>

          <TouchableOpacity activeOpacity={0.88} onPress={openStore} style={styles.ctaWrap}>
            <LinearGradient
              colors={[colors.brandYellow, '#D4A017']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cta}
            >
              <AppIcon name="arrow-forward" size={22} color="#FFFFFF" />
              <Text style={styles.ctaLabel}>Update now</Text>
            </LinearGradient>
          </TouchableOpacity>

          <Text style={[styles.footerNote, { color: colors.textTertiary }]}>
            After updating, return to HungerTap — we will verify your version automatically.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingBottom: 22,
    paddingTop: 20,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
    overflow: 'hidden',
  },
  cardAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  iconRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
    marginTop: 8,
  },
  title: {
    fontSize: 22,
    fontFamily: appTypography.bold,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: appTypography.regular,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 18,
  },
  versionBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 20,
    gap: 6,
  },
  versionLine: {
    fontSize: 14,
    fontFamily: appTypography.regular,
    textAlign: 'center',
  },
  ctaWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 14,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 10,
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: appTypography.bold,
  },
  footerNote: {
    fontSize: 12,
    fontFamily: appTypography.regular,
    textAlign: 'center',
    lineHeight: 18,
  },
});
