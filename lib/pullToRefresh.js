import { Platform } from 'react-native';

/**
 * Keeps the native refresh spinner below fixed headers (iOS pushes content down without this).
 */
export function pullRefreshProgressOffset(stripHeight, extraHeaderHeight = 0) {
  return Math.round(stripHeight + extraHeaderHeight);
}

export function pullRefreshControlProps({
  refreshing,
  onRefresh,
  tintColor,
  progressOffset = 0,
  androidBackgroundColor,
}) {
  return {
    refreshing,
    onRefresh,
    tintColor,
    progressViewOffset: progressOffset,
    colors: Platform.OS === 'android' ? [tintColor] : undefined,
    progressBackgroundColor:
      Platform.OS === 'android' ? androidBackgroundColor : undefined,
  };
}
