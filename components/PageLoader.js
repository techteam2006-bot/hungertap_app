import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { useTheme } from '../lib/ThemeContext';
import { GLOBAL_LOADING_LOGO } from '../lib/appLogo';
import LoadingSpinner from './LoadingSpinner';

/**
 * Full-screen or inline centered loader. Use `compact` for list/section placeholders.
 */
export default function PageLoader({
  message,
  /** When true, show spinner + optional message instead of logo */
  compact = false,
  /** Shown when compact is false */
  showLogo = true,
  style,
  logoStyle,
}) {
  const { colors } = useTheme();

  if (compact) {
    return (
      <View style={[styles.compact, style]} accessibilityLabel={message || 'Loading content'}>
        <LoadingSpinner size="large" />
        {message ? (
          <Text style={[styles.compactMessage, { color: colors.textSecondary }]}>{message}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[styles.full, { backgroundColor: colors.loadingBackground }, style]}
      accessibilityLabel={message || 'Loading'}
    >
      {showLogo ? (
        <Image
          source={GLOBAL_LOADING_LOGO}
          style={[styles.logo, logoStyle]}
          resizeMode="contain"
        />
      ) : (
        <LoadingSpinner size="large" />
      )}
      {message ? (
        <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  full: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 240,
    height: 240,
  },
  message: {
    marginTop: 16,
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  compact: {
    flex: 1,
    minHeight: 120,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
  },
  compactMessage: {
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});
