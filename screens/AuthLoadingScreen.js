import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/ThemeContext';
import { AUTH_LOADING_LOGO } from '../lib/appLogo';
import { appTypography } from '../lib/darkThemeConfig';

/** HC mark on dark ground — pairs with dark loading background. */
const AUTH_LOADING_LOGO_DARK = require('../assets/logo1.png');

/**
 * Full-screen branded loader shown after signup/login while the session/profile
 * finishes loading before MainTabs. Adapts to light/dark theme.
 */
export default function AuthLoadingScreen({ message = 'Loading...' }) {
  const insets = useSafeAreaInsets();
  const { colors, isDarkMode } = useTheme();

  const backgroundColor = colors.loadingBackground || colors.splashBackground || colors.pageBackground;
  const hungerColor = colors.text;
  const tapColor = colors.brandYellow;
  const mutedColor = colors.textSecondary || colors.textTertiary;
  const logoSource = isDarkMode ? AUTH_LOADING_LOGO_DARK : AUTH_LOADING_LOGO;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
      accessibilityLabel={message}
      accessible
    >
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={backgroundColor}
      />

      <View style={styles.brandBlock}>
        <Image
          source={logoSource}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text style={styles.wordmark} accessibilityRole="header">
          <Text style={[styles.hunger, { color: hungerColor }]}>Hunger</Text>
          <Text style={[styles.tap, { color: tapColor }]}>Tap</Text>
        </Text>
        <Text style={[styles.tagline, { color: mutedColor }]}>Smart Campus Canteen</Text>
      </View>

      <View style={styles.loaderBlock}>
        <ActivityIndicator size="large" color={tapColor} />
        <Text style={[styles.loadingText, { color: mutedColor }]}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  brandBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    width: 200,
    height: 200,
    marginBottom: 18,
  },
  wordmark: {
    fontSize: 40,
    fontFamily: appTypography.bold,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  hunger: {},
  tap: {},
  tagline: {
    marginTop: 8,
    fontSize: 15,
    fontFamily: appTypography.regular,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  loaderBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 72,
    gap: 14,
  },
  loadingText: {
    fontSize: 15,
    fontFamily: appTypography.regular,
    letterSpacing: 0.2,
  },
});
