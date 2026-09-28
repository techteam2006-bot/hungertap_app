import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../lib/ThemeContext';
import { ITEM_IMAGE_FALLBACK } from '../lib/appLogo';
import { rememberImageUris } from '../lib/ImageCache';

/**
 * Menu / explore / detail item photos.
 * Uses expo-image so Android does not leave progressive JPEGs half-painted
 * (RN Image + Fresco often shows top half only).
 */
const OptimizedImage = ({
  source,
  style,
  resizeMode = 'cover',
  fallbackIcon: _fallbackIcon = 'restaurant',
  showLoadingIndicator: _showLoadingIndicator = true,
  priority = 'normal',
  ...props
}) => {
  const { colors, isDarkMode } = useTheme();
  const [error, setError] = useState(false);

  const remoteUri = typeof source === 'object' && source?.uri ? String(source.uri) : null;
  const isLocalAsset = typeof source === 'number';

  const frameBg = isDarkMode ? '#1A1A1A' : colors.mutedRowBackground || '#EFEFEF';
  const contentFit = resizeMode === 'contain' ? 'contain' : 'cover';

  const resolvedSource = useMemo(() => {
    if (error || source == null) return ITEM_IMAGE_FALLBACK;
    if (isLocalAsset) return source;
    if (remoteUri) return { uri: remoteUri };
    return ITEM_IMAGE_FALLBACK;
  }, [source, remoteUri, isLocalAsset, error]);

  const recyclingKey = remoteUri || (isLocalAsset ? `asset:${source}` : 'fallback');

  const handleError = useCallback(() => {
    setError(true);
  }, []);

  const handleLoad = useCallback(() => {
    setError(false);
    if (remoteUri && remoteUri.startsWith('http')) {
      rememberImageUris([remoteUri]).catch(() => {});
    }
  }, [remoteUri]);

  // Reset error when the item/image URL changes
  const sourceKey = remoteUri || (isLocalAsset ? String(source) : 'none');
  React.useEffect(() => {
    setError(false);
  }, [sourceKey]);

  return (
    <View style={[styles.frame, style, { backgroundColor: frameBg }]}>
      <Image
        source={resolvedSource}
        style={styles.image}
        contentFit={error || !remoteUri ? 'contain' : contentFit}
        cachePolicy="memory-disk"
        recyclingKey={recyclingKey}
        priority={priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'normal'}
        transition={Platform.OS === 'ios' ? 150 : 0}
        onError={handleError}
        onLoad={handleLoad}
        accessibilityIgnoresInvertColors
        {...props}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});

export default OptimizedImage;
