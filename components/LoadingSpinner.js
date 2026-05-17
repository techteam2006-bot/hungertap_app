import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useTheme } from '../lib/ThemeContext';

/**
 * Themed ActivityIndicator wrapper for inline and overlay use.
 */
export default function LoadingSpinner({
  size = 'small',
  color,
  style,
  accessibilityLabel = 'Loading',
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, style]} accessibilityLabel={accessibilityLabel} accessible>
      <ActivityIndicator size={size} color={color ?? colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
