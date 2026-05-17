import React from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../lib/ThemeContext';

/**
 * Async action button: disables while loading, optional spinner + processing label.
 * Pass `loading` or `isLoading` (same meaning).
 */
export default function LoadingButton({
  onPress,
  title,
  loading,
  isLoading,
  loadingTitle = 'Processing...',
  disabled = false,
  style,
  textStyle,
  indicatorColor = '#FFFFFF',
  showSpinner = true,
  activeOpacity = 0.85,
  ...rest
}) {
  const { colors } = useTheme();
  const busy = Boolean(loading ?? isLoading);
  const mergedDisabled = disabled || busy;

  const handlePress = () => {
    if (mergedDisabled) return;
    onPress?.();
  };

  return (
    <TouchableOpacity
      style={[
        styles.touchable,
        { backgroundColor: colors.primary },
        mergedDisabled && styles.touchableDisabled,
        style,
      ]}
      onPress={handlePress}
      disabled={mergedDisabled}
      activeOpacity={mergedDisabled ? 1 : activeOpacity}
      accessibilityState={{ busy, disabled: mergedDisabled }}
      {...rest}
    >
      {busy ? (
        <View style={styles.row}>
          {showSpinner ? (
            <ActivityIndicator color={indicatorColor} size="small" style={styles.spinnerMargin} />
          ) : null}
          <Text style={[styles.label, { color: indicatorColor }, textStyle]}>{loadingTitle}</Text>
        </View>
      ) : (
        <Text style={[styles.label, { color: indicatorColor }, textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchable: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  touchableDisabled: {
    opacity: 0.72,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerMargin: {
    marginRight: 10,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
