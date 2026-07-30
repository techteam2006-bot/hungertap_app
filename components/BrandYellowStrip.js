import React from 'react';
import { View, StatusBar, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/ThemeContext';

/** Yellow status-bar band height — same rule on every screen (Home reference). */
export function useBrandStripHeight() {
  const insets = useSafeAreaInsets();
  // iOS: fill the full status-bar inset so yellow sits behind clock/signal like Home.
  // Android: fixed 34 matches existing Home / Cart strip.
  if (Platform.OS === 'ios') {
    return Math.max(insets.top, 44);
  }
  return 34;
}

/**
 * Brand yellow strip under the status bar.
 * @param {{ absolute?: boolean, barStyle?: 'dark-content' | 'light-content' }} props
 *   absolute = overlay at top (Home-style); else in-flow.
 */
export default function BrandYellowStrip({ absolute = false, barStyle = 'dark-content' }) {
  const { colors } = useTheme();
  const height = useBrandStripHeight();

  return (
    <>
      <StatusBar
        translucent
        backgroundColor={colors.brandYellow}
        barStyle={barStyle}
      />
      <View
        pointerEvents="none"
        style={[
          absolute ? styles.absolute : null,
          {
            height,
            width: '100%',
            backgroundColor: colors.brandYellow,
          },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  absolute: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99,
  },
});
