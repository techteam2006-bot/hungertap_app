import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Image, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../lib/ThemeContext';
import { ITEM_IMAGE_FALLBACK } from '../lib/appLogo';

// Global image cache for faster loading
const imageCache = new Map();
const prefetchQueue = new Set();

function sourceKey(source) {
  if (source == null) return '';
  if (typeof source === 'number') return `n:${source}`;
  if (typeof source === 'object' && typeof source.uri === 'string') return `u:${source.uri}`;
  return 'x';
}

const OptimizedImage = ({
  source,
  style,
  resizeMode = 'cover',
  fallbackIcon: _fallbackIcon = 'restaurant',
  showLoadingIndicator = true,
  priority = 'normal', // 'high', 'normal', 'low'
  ...props
}) => {
  const { colors } = useTheme();
  const key = useMemo(() => sourceKey(source), [source]);
  const uri = typeof source === 'object' && source?.uri ? source.uri : null;
  const alreadyCached = !!(uri && imageCache.has(uri));

  const [loading, setLoading] = useState(!alreadyCached && !!uri);
  const [error, setError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(alreadyCached);

  // Remote URI may change — reset load state when switching items.
  useEffect(() => {
    const cached = !!(uri && imageCache.has(uri));
    setError(false);
    setLoading(!cached && !!uri);
    setImageLoaded(cached);
  }, [key, uri]);

  const memoizedSource = useMemo(() => {
    if (source == null) return null;
    if (typeof source === 'number') return source;
    if (typeof source === 'object' && source.uri) {
      // Do not force iOS disk cache — it can blank images on first paint.
      return { uri: source.uri };
    }
    return source;
  }, [key, source]);

  // Prefetch in background (does not gate display)
  useEffect(() => {
    const prefetchUri = memoizedSource?.uri;
    if (!prefetchUri || prefetchQueue.has(prefetchUri) || imageCache.has(prefetchUri)) {
      return undefined;
    }
    prefetchQueue.add(prefetchUri);
    let cancelled = false;
    Image.prefetch(prefetchUri)
      .then(() => {
        if (!cancelled) imageCache.set(prefetchUri, true);
      })
      .catch(() => {})
      .finally(() => {
        prefetchQueue.delete(prefetchUri);
      });
    return () => {
      cancelled = true;
    };
  }, [memoizedSource?.uri]);

  const handleLoadStart = useCallback(() => {
    setLoading(true);
    setError(false);
  }, []);

  const handleLoad = useCallback(() => {
    setLoading(false);
    setImageLoaded(true);
    setError(false);
    if (uri) imageCache.set(uri, true);
  }, [uri]);

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
  }, []);

  const handleError = useCallback(() => {
    setLoading(false);
    setImageLoaded(false);
    setError(true);
    if (uri) imageCache.delete(uri);
  }, [uri]);

  if (!memoizedSource || error) {
    return (
      <View style={[styles.fallbackContainer, style, { backgroundColor: colors.surface || '#F3F4F6' }]}>
        <Image
          source={ITEM_IMAGE_FALLBACK}
          style={styles.fallbackLogo}
          resizeMode="contain"
          accessibilityLabel="Item image placeholder"
        />
      </View>
    );
  }

  const showSpinner = !imageLoaded && (loading || showLoadingIndicator);

  return (
    <View style={[styles.frame, style, { backgroundColor: colors.surface || '#F3F4F6' }]}>
      <Image
        key={key}
        source={memoizedSource}
        style={styles.image}
        resizeMode={resizeMode}
        onLoadStart={handleLoadStart}
        onLoad={handleLoad}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        fadeDuration={Platform.OS === 'android' ? 0 : undefined}
        accessibilityIgnoresInvertColors
        {...props}
      />

      {showSpinner ? (
        <View style={[styles.loadingContainer, { backgroundColor: colors.surface || '#F3F4F6' }]}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : null}
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
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  fallbackContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    overflow: 'hidden',
  },
  fallbackLogo: {
    width: '72%',
    height: '72%',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default OptimizedImage;
