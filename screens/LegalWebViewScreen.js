import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';
import BrandYellowStrip from '../components/BrandYellowStrip';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';

const QUANTITY_IMAGE_NOTE =
  'NOTE: The quantity in the image may differ from the original item quantity';

/** Inserts the quantity note as the second-last point in the Order Collection section. */
const INSERT_ORDER_COLLECTION_NOTE = `(function() {
  try {
    var marker = 'quantity in the image may differ from the original item quantity';
    if (document.body && (document.body.innerText || '').toLowerCase().indexOf(marker) !== -1) return;
    var headings = document.querySelectorAll('h3.section-title, .section-title');
    for (var i = 0; i < headings.length; i++) {
      if ((headings[i].textContent || '').indexOf('Order Collection') === -1) continue;
      var last = null;
      var el = headings[i].nextElementSibling;
      while (el && el.tagName !== 'H2' && el.tagName !== 'H3') {
        last = el;
        el = el.nextElementSibling;
      }
      if (!last || !last.parentNode) break;
      var p = document.createElement('p');
      p.textContent = ${JSON.stringify(QUANTITY_IMAGE_NOTE)};
      last.parentNode.insertBefore(p, last);
      break;
    }
  } catch (e) {}
})();
true;`;

const LegalWebViewScreen = ({ navigation, route }) => {
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const webRef = useRef(null);
  const title = route?.params?.title || 'Legal';
  const url = route?.params?.url || '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const isTermsOfService =
    typeof url === 'string' && url.toLowerCase().includes('termsofservice.hungertap.online');

  return (
    <View style={[styles.root, { backgroundColor: colors.contentBackground }]}>
      <BrandYellowStrip barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      <View style={[styles.header, { backgroundColor: colors.elevatedSurface }]}>
        <View style={styles.headerSide}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <AppIcon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerSide} />
      </View>

      <View style={[styles.headerSeparator, { backgroundColor: colors.border }]} />

      {!url ? (
        <View style={styles.fallback}>
          <Text style={[styles.fallbackText, { color: colors.textSecondary }]}>
            This page is unavailable right now.
          </Text>
        </View>
      ) : error ? (
        <View style={styles.fallback}>
          <Text style={[styles.fallbackText, { color: colors.textSecondary }]}>
            Couldn’t load this page. Check your connection and try again.
          </Text>
          <TouchableOpacity
            onPress={() => {
              setError(false);
              setLoading(true);
            }}
            style={styles.retryBtn}
            activeOpacity={0.75}
          >
            <Text style={[styles.retryLabel, { color: colors.brandYellow }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.webWrap, { marginBottom: insets.bottom }]}>
          <WebView
            ref={webRef}
            style={styles.web}
            source={{ uri: url }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            setSupportMultipleWindows={false}
            originWhitelist={['https://*', 'http://*']}
            injectedJavaScript={isTermsOfService ? INSERT_ORDER_COLLECTION_NOTE : undefined}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => {
              setLoading(false);
              if (isTermsOfService) {
                webRef.current?.injectJavaScript(INSERT_ORDER_COLLECTION_NOTE);
              }
            }}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
            onHttpError={() => {
              setLoading(false);
              setError(true);
            }}
          />
          {loading ? (
            <View style={[styles.loadingOverlay, { backgroundColor: colors.contentBackground }]}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingHint, { color: colors.textSecondary }]}>Loading…</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  strip: {
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerSide: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontFamily: appTypography.bold,
  },
  headerSeparator: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  webWrap: {
    flex: 1,
    position: 'relative',
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingHint: {
    fontSize: 14,
    fontFamily: appTypography.regular,
  },
  fallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  fallbackText: {
    fontSize: 15,
    fontFamily: appTypography.regular,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryLabel: {
    fontSize: 15,
    fontFamily: appTypography.semiBold,
  },
});

export default LegalWebViewScreen;
