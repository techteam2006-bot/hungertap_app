import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Image, ActivityIndicator, StyleSheet } from 'react-native';
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
  showLoadingIndicator = false,
  priority = 'normal', // 'high', 'normal', 'low'
  ...props
}) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const key = useMemo(() => sourceKey(source), [source]);

  // Remote URI may change while `useMemo` on `source?.uri` alone stays `undefined` for
  // bundled assets — and `error` must reset when switching items or the next image never shows.
  useEffect(() => {
    setError(false);
    setLoading(false);
    setImageLoaded(false);
  }, [key]);

  const memoizedSource = useMemo(() => {
    if (source == null) return null;
    if (typeof source === 'number') return source;
    if (typeof source === 'object' && source.uri) {
      const uri = source.uri;
      if (imageCache.has(uri)) {
        return { ...source, cached: true };
      }
      return source;
    }
    return source;
  }, [key, source]);

  // Optimized prefetch with priority handling
  useEffect(() => {
    if (memoizedSource?.uri && !prefetchQueue.has(memoizedSource.uri)) {
      prefetchQueue.add(memoizedSource.uri);

      if (priority === 'high') {
        Image.prefetch(memoizedSource.uri)
          .then(() => {
            imageCache.set(memoizedSource.uri, true);
            prefetchQueue.delete(memoizedSource.uri);
          })
          .catch(() => {
            prefetchQueue.delete(memoizedSource.uri);
          });
      } else {
        const delay = priority === 'low' ? 1000 : 100;
        setTimeout(() => {
          Image.prefetch(memoizedSource.uri)
            .then(() => {
              imageCache.set(memoizedSource.uri, true);
              prefetchQueue.delete(memoizedSource.uri);
            })
            .catch(() => {
              prefetchQueue.delete(memoizedSource.uri);
            });
        }, delay);
      }
    }
  }, [memoizedSource?.uri, priority]);

  const handleLoadStart = useCallback(() => {
    setLoading(true);
    setError(false);
  }, []);

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
    setImageLoaded(true);
    if (memoizedSource?.uri) {
      imageCache.set(memoizedSource.uri, true);
    }
  }, [memoizedSource?.uri]);

  const handleError = useCallback(() => {
    setLoading(false);
    setError(true);
    if (memoizedSource?.uri) {
      imageCache.delete(memoizedSource.uri);
    }
  }, [memoizedSource?.uri]);

  if (!memoizedSource || error) {
    return (
      <View style={[styles.fallbackContainer, style, { backgroundColor: colors.surface }]}>
        <Image
          source={ITEM_IMAGE_FALLBACK}
          style={styles.fallbackLogo}
          resizeMode="contain"
          accessibilityLabel="Item image placeholder"
        />
      </View>
    );
  }

  return (
    <View style={style}>
      <Image
        key={key}
        source={memoizedSource}
        style={[StyleSheet.absoluteFillObject, { borderRadius: style?.borderRadius || 0 }]}
        resizeMode={resizeMode}
        onLoadStart={handleLoadStart}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        fadeDuration={0}
        loadingIndicatorSource={null}
        progressiveRenderingEnabled={true}
        removeClippedSubviews={true}
        {...props}
      />

      {loading && (priority === 'high' || showLoadingIndicator) && !imageLoaded && (
        <View style={[styles.loadingContainer, { backgroundColor: colors.surface }]}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
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
    borderRadius: 8,
  },
});

export default OptimizedImage;
