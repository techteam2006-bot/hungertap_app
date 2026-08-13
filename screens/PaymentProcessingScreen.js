import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Platform,
  Linking,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useTheme } from '../lib/ThemeContext';
import BrandYellowStrip from '../components/BrandYellowStrip';
import { appTypography } from '../lib/darkThemeConfig';
import { supabase } from '../lib/supabase';
import { useCart } from '../lib/CartContext';
import { useAuth } from '../lib/AuthContext';
import {
  parsePaymentReturnUrl,
  isPaymentReturnUrl,
  isAllowedCheckoutUrl,
} from '../lib/paymentDeepLink';
import { isValidOrderUuid } from '../lib/checkoutSecurity';
import { resetNavigationToCart } from '../lib/navigateHome';
import { isOrderPlacedSuccessStatus, isCancelledLike } from '../lib/orderStatus';
import {
  cancelCheckoutPayment,
  GATEWAY_CANCEL_INJECT_JS,
} from '../lib/cancelCheckoutPayment';
import {
  isCashfreeNativeSdkAvailable,
  describeCashfreeSdkAvailability,
  configureCashfreeCallbacks,
  clearCashfreeCallbacks,
  startCashfreeCheckout,
} from '../lib/cashfreeCheckout';
import {
  isEasebuzzNativeSdkAvailable,
  startEasebuzzCheckout,
} from '../lib/easebuzzCheckout';

const POLL_MS = 2500;
const STUCK_MS = 180000;

/**
 * Both gateways run through their native SDK. Easebuzz additionally keeps the
 * server-issued `payment_url` as a WebView fallback for runtimes without the
 * native module (Expo Go, or a launch failure).
 */
const MODE = {
  CASHFREE_SDK: 'cashfree-sdk',
  CASHFREE_WEBVIEW: 'cashfree-webview',
  EASEBUZZ_SDK: 'easebuzz-sdk',
  EASEBUZZ_WEBVIEW: 'easebuzz-webview',
  UNAVAILABLE: 'unavailable',
};

const SDK_MODES = [MODE.CASHFREE_SDK, MODE.EASEBUZZ_SDK];

/** Cashfree session ids are interpolated into a <script> tag — validate, never trust. */
const CASHFREE_SESSION_RE = /^session_[A-Za-z0-9_-]{10,400}$/;

/**
 * Cashfree has no URL you can navigate to for a payment_session_id — the session
 * must be handed to their JS SDK. This page is the fallback for runtimes without
 * the native module (Expo Go, or a launch failure).
 *
 * `isSandbox` comes from the server's gateway_environment, never from __DEV__.
 */
function buildCashfreeWebJsSdkHtml(sessionId, isSandbox) {
  const mode = isSandbox ? 'sandbox' : 'production';
  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 0;
        background-color: #0d1117; color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        display: flex; align-items: center; justify-content: center; height: 100vh;
      }
      .spinner {
        width: 38px; height: 38px;
        border: 4px solid rgba(255,255,255,0.15); border-left-color: #e5c100;
        border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px auto;
      }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div style="text-align:center;">
      <div class="spinner"></div>
      <div style="font-size:15px;color:#cbd5e0;">Loading Cashfree Secure Checkout…</div>
    </div>
    <script>
      (function () {
        try {
          Cashfree({ mode: "${mode}" }).checkout({
            paymentSessionId: "${sessionId}",
            redirectTarget: "_self"
          });
        } catch (e) {
          console.error("Cashfree checkout error:", e);
        }
      })();
    </script>
  </body>
</html>`;
}

/**
 * Map a native SDK result onto the same outcomes `parsePaymentReturnUrl` yields
 * for the WebView flow. Advisory only — the `orders` row stays authoritative and
 * is still polled throughout.
 * @returns {'success'|'cancelled'|'failure'}
 */
function mapGatewaySdkResult(payload) {
  const result = String(payload?.result ?? payload ?? '').toLowerCase();
  const status = String(payload?.payment_response?.status ?? payload?.status ?? '').toLowerCase();
  const s = `${result} ${status}`;

  if (s.includes('success')) return 'success';
  if (s.includes('cancel') || s.includes('back_press') || s.includes('dropped') || s.includes('user_cancelled')) return 'cancelled';
  return 'failure';
}

const PaymentProcessingScreen = ({ navigation, route }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { clearCart } = useCart();
  const { userId, getSupabaseToken } = useAuth();
  const {
    gateway = 'cashfree',
    paymentUrl: initialPaymentUrl,
    paymentSessionId: initialPaymentSessionId,
    environment: initialEnvironment,
    orderId,
    paymentId: initialPaymentId,
    orderItems = [],
    orderTotal = 0,
  } = route.params || {};

  const finalizedRef = useRef(false);
  const stuckTimerRef = useRef(null);
  const pollOnceRef = useRef(null);
  const webRef = useRef(null);
  const cancelInFlightRef = useRef(false);
  const allowLeaveRef = useRef(false);
  const sdkStartedRef = useRef(false);

  const [activePaymentUrl] = useState(() => String(initialPaymentUrl || '').trim());
  const [activePaymentId] = useState(
    initialPaymentId != null ? String(initialPaymentId) : ''
  );
  const [activePaymentSessionId] = useState(
    initialPaymentSessionId != null ? String(initialPaymentSessionId).trim() : ''
  );
  const [environment] = useState(() =>
    String(initialEnvironment || '').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX'
  );
  const [webviewKey] = useState(0);
  const [checkoutClosed, setCheckoutClosed] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const isCashfree = gateway === 'cashfree';

  const cashfreeSessionId = useMemo(
    () => (CASHFREE_SESSION_RE.test(activePaymentSessionId) ? activePaymentSessionId : ''),
    [activePaymentSessionId]
  );

  const [mode, setMode] = useState(() => {
    if (isCashfree) {
      if (isCashfreeNativeSdkAvailable()) return MODE.CASHFREE_SDK;
      return CASHFREE_SESSION_RE.test(activePaymentSessionId)
        ? MODE.CASHFREE_WEBVIEW
        : MODE.UNAVAILABLE;
    }
    if (isEasebuzzNativeSdkAvailable() && activePaymentSessionId) return MODE.EASEBUZZ_SDK;
    return isAllowedCheckoutUrl(activePaymentUrl) ? MODE.EASEBUZZ_WEBVIEW : MODE.UNAVAILABLE;
  });

  const webViewSource = useMemo(() => {
    if (mode === MODE.CASHFREE_WEBVIEW) {
      if (!cashfreeSessionId) return null;
      const isSandbox = environment !== 'PRODUCTION';
      return {
        html: buildCashfreeWebJsSdkHtml(cashfreeSessionId, isSandbox),
        baseUrl: isSandbox ? 'https://sandbox.cashfree.com' : 'https://payments.cashfree.com',
      };
    }
    const url = String(activePaymentUrl || '').trim();
    return isAllowedCheckoutUrl(url) ? { uri: url } : null;
  }, [mode, cashfreeSessionId, environment, activePaymentUrl]);

  const finalizeSuccess = useCallback(async () => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    allowLeaveRef.current = true;
    if (stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = null;
    }
    try {
      await clearCart({ silent: true });
    } catch (_) {}

    let orderToken = '';
    let total = Number(orderTotal) || 0;
    try {
      if (userId && isValidOrderUuid(orderId)) {
        const { data: row } = await supabase
          .from('orders')
          .select('order_token, total_amount')
          .eq('id', orderId)
          .eq('placed_by', userId)
          .maybeSingle();
        orderToken = row?.order_token != null ? String(row.order_token) : '';
        const ta = row?.total_amount != null ? Number(row.total_amount) : NaN;
        if (Number.isFinite(ta) && ta > 0) total = ta;
      }
    } catch (_) {}

    navigation.replace('OrderConfirmation', {
      orderId,
      orderToken,
      totalAmount: total,
      orderItems,
      paymentMethod: gateway === 'cashfree' ? 'cashfree' : 'easebuzz_v2',
    });
  }, [clearCart, navigation, orderId, orderItems, orderTotal, userId, gateway]);

  const leaveCheckout = useCallback(() => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    allowLeaveRef.current = true;
    setCheckoutClosed(true);
    if (stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = null;
    }
    resetNavigationToCart(navigation);
  }, [navigation]);

  const sendCancelToGateway = useCallback(async () => {
    try {
      try {
        webRef.current?.injectJavaScript(GATEWAY_CANCEL_INJECT_JS);
      } catch (_) {}

      let accessToken = '';
      try {
        accessToken = (await getSupabaseToken?.()) || '';
      } catch (_) {}

      await cancelCheckoutPayment({
        accessToken,
        orderId,
        paymentId: activePaymentId,
        userId,
        supabaseClient: supabase,
      });
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('cancelCheckoutPayment:', e?.message || e);
      }
    }
  }, [activePaymentId, getSupabaseToken, orderId, userId]);

  const finalizeCancel = useCallback(async () => {
    if (finalizedRef.current || cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    await sendCancelToGateway();
    leaveCheckout();
  }, [leaveCheckout, sendCancelToGateway]);

  const finalizeFailure = useCallback(() => {
    leaveCheckout();
  }, [leaveCheckout]);

  const promptAbandonCheckout = useCallback(() => {
    if (finalizedRef.current || cancelInFlightRef.current) return true;
    Alert.alert(
      'Cancel payment?',
      'If you go back now, this payment will be cancelled and you will need to place the order again.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'OK',
          style: 'destructive',
          onPress: () => {
            finalizeCancel();
          },
        },
      ]
    );
    return true;
  }, [finalizeCancel]);

  const applyOrderStatus = useCallback(
    (status) => {
      if (!status || finalizedRef.current) return;
      if (isOrderPlacedSuccessStatus(status)) {
        finalizeSuccess();
        return;
      }
      if (status === 'payment_cancelled') {
        allowLeaveRef.current = true;
        leaveCheckout();
        return;
      }
      if (isCancelledLike(status) || status === 'payment_failed') {
        finalizeFailure();
      }
    },
    [finalizeSuccess, leaveCheckout, finalizeFailure]
  );

  const refreshPaymentStatus = useCallback(async () => {
    if (!orderId || !userId || !isValidOrderUuid(orderId) || finalizedRef.current) return;
    try {
      const { data: ord } = await supabase
        .from('orders')
        .select('status')
        .eq('id', orderId)
        .eq('placed_by', userId)
        .maybeSingle();
      if (ord?.status) applyOrderStatus(ord.status);
    } catch (_) {
      /* network — next poll */
    }
  }, [orderId, userId, applyOrderStatus]);

  pollOnceRef.current = refreshPaymentStatus;

  /** Shared by the WebView return-URL path and the native SDK callbacks. */
  const applyCheckoutOutcome = useCallback(
    (outcome) => {
      if (outcome === 'success' || outcome === 'return_to_app') {
        // The gateway handed control back but only the webhook knows whether
        // money moved — cover the checkout UI while the order row is polled.
        setVerifying(true);
        refreshPaymentStatus();
      } else if (outcome === 'cancelled') {
        finalizeCancel();
      } else {
        finalizeFailure();
      }
    },
    [refreshPaymentStatus, finalizeCancel, finalizeFailure]
  );

  // Active polling loop while verifying === true (runs every 0.5s for up to 30s)
  useEffect(() => {
    if (!verifying || finalizedRef.current) return undefined;

    let attempts = 0;
    const maxAttempts = 60; // 60 * 0.5s = 30 seconds total

    const intervalId = setInterval(async () => {
      attempts += 1;
      if (finalizedRef.current) {
        clearInterval(intervalId);
        return;
      }

      await refreshPaymentStatus();

      if (attempts >= maxAttempts) {
        clearInterval(intervalId);
        if (!finalizedRef.current) {
          Alert.alert(
            'Verification Taking Longer',
            'Your payment is being verified with the bank. Please check My Orders to see your order status.',
            [
              {
                text: 'View Orders',
                onPress: () => {
                  allowLeaveRef.current = true;
                  navigation.reset({
                    index: 0,
                    routes: [{ name: 'MainTabs', params: { screen: 'Orders' } }],
                  });
                },
              },
            ]
          );
        }
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [verifying, refreshPaymentStatus, navigation]);

  // Held in a ref so the async SDK effects below never re-run (and never drop a
  // pending gateway result) just because a callback identity changed.
  const applyOutcomeRef = useRef(null);
  applyOutcomeRef.current = applyCheckoutOutcome;

  const handlePaymentReturnUrl = useCallback(
    (url) => {
      const outcome = parsePaymentReturnUrl(url);
      if (!outcome) return false;

      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('🎉 [Step 7/7] Payment Return URL Intercepted:', url, 'Outcome:', outcome);
      }

      applyCheckoutOutcome(outcome);
      return true;
    },
    [applyCheckoutOutcome]
  );

  // --- Native SDK: Cashfree -------------------------------------------------
  useEffect(() => {
    if (mode !== MODE.CASHFREE_SDK) return undefined;

    configureCashfreeCallbacks({
      onVerify: () => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          // eslint-disable-next-line no-console
          console.log('🎉 [Step 7/7] Cashfree SDK onVerify. Outcome: success');
        }
        applyOutcomeRef.current?.('success');
      },
      onError: (error) => {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          // eslint-disable-next-line no-console
          console.log('🎉 [Step 7/7] Cashfree SDK onError:', error?.message || error);
        }
        // The user dismissed or the payment failed — the order row decides which.
        pollOnceRef.current?.();
        setTimeout(() => {
          if (!finalizedRef.current) applyOutcomeRef.current?.('cancelled');
        }, 800);
      },
    });

    if (!sdkStartedRef.current) {
      sdkStartedRef.current = true;
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('📱 [Step 5/7] [PaymentProcessingScreen] Launching Cashfree native SDK. Environment:', environment);
      }
      try {
        startCashfreeCheckout({
          paymentSessionId: activePaymentSessionId,
          orderId,
          environment,
        });
      } catch (e) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[Cashfree] startCashfreeCheckout failed, falling back to WebView:', e?.message || e);
        }
        sdkStartedRef.current = false;
        setMode(cashfreeSessionId ? MODE.CASHFREE_WEBVIEW : MODE.UNAVAILABLE);
      }
    }

    return () => clearCashfreeCallbacks();
  }, [mode, activePaymentSessionId, cashfreeSessionId, orderId, environment]);

  // --- Native SDK: Easebuzz (falls back to the server-issued URL) -----------
  useEffect(() => {
    if (mode !== MODE.EASEBUZZ_SDK || sdkStartedRef.current) return;
    sdkStartedRef.current = true;

    let cancelled = false;
    (async () => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('📱 [Step 5/7] [PaymentProcessingScreen] Launching Easebuzz native SDK. Environment:', environment);
      }

      const res = await startEasebuzzCheckout({
        accessKey: activePaymentSessionId,
        environment,
      });
      if (cancelled) return;

      if (res.launchFailed) {
        // Checkout never opened — nothing was shown to the user, so fall back.
        sdkStartedRef.current = false;
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          // eslint-disable-next-line no-console
          console.log('↩️ [PaymentProcessingScreen] Easebuzz SDK unavailable, falling back to payment URL.');
        }
        setMode(isAllowedCheckoutUrl(activePaymentUrl) ? MODE.EASEBUZZ_WEBVIEW : MODE.UNAVAILABLE);
        return;
      }

      const outcome = mapGatewaySdkResult(res.payload);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('🎉 [Step 7/7] Easebuzz SDK result:', res.payload?.result, 'Outcome:', outcome);
      }
      applyOutcomeRef.current?.(outcome);
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, activePaymentSessionId, activePaymentUrl, environment]);

  useEffect(() => {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;
    if (mode === MODE.EASEBUZZ_WEBVIEW) {
      // eslint-disable-next-line no-console
      console.log('📱 [Step 5/7] [PaymentProcessingScreen] Loading backend payment URL in WebView:', activePaymentUrl);
    } else if (mode === MODE.CASHFREE_WEBVIEW) {
      // eslint-disable-next-line no-console
      console.log(
        '📱 [Step 5/7] [PaymentProcessingScreen] Cashfree native SDK unavailable — using Web JS SDK fallback. Environment:',
        environment,
        '| Reason:',
        describeCashfreeSdkAvailability()
      );
    }
  }, [mode, activePaymentUrl, environment]);

  useEffect(() => {
    const onHardwareBack = () => promptAbandonCheckout();
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [promptAbandonCheckout]);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current || finalizedRef.current) return;
      e.preventDefault();
      promptAbandonCheckout();
    });
    return unsub;
  }, [navigation, promptAbandonCheckout]);

  useEffect(() => {
    if (!orderId || !isValidOrderUuid(orderId)) {
      Alert.alert('Checkout error', 'Missing order reference. Return to the cart and try again.', [
        {
          text: 'OK',
          onPress: () => {
            allowLeaveRef.current = true;
            resetNavigationToCart(navigation);
          },
        },
      ]);
      return;
    }
    if (!userId) {
      Alert.alert('Sign in required', 'Please sign in again to complete payment.', [
        {
          text: 'OK',
          onPress: () => {
            allowLeaveRef.current = true;
            navigation.replace('Login');
          },
        },
      ]);
      return;
    }

    let pollTimer = null;

    refreshPaymentStatus();
    pollTimer = setInterval(() => pollOnceRef.current?.(), POLL_MS);

    stuckTimerRef.current = setTimeout(() => {
      if (finalizedRef.current) return;
      Alert.alert(
        'Still processing',
        'Payment can take a moment. You can leave this screen — your order status under Orders updates automatically.',
        [{ text: 'OK' }]
      );
    }, STUCK_MS);

    const onLink = (event) => {
      const url = typeof event === 'string' ? event : event?.url;
      if (url) handlePaymentReturnUrl(url);
    };

    const linkSub = Linking.addEventListener('url', onLink);
    Linking.getInitialURL()
      .then((url) => {
        if (url) handlePaymentReturnUrl(url);
      })
      .catch(() => {});

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (stuckTimerRef.current) {
        clearTimeout(stuckTimerRef.current);
        stuckTimerRef.current = null;
      }
      linkSub.remove();
    };
  }, [
    orderId,
    userId,
    applyOrderStatus,
    navigation,
    refreshPaymentStatus,
    handlePaymentReturnUrl,
  ]);

  const onShouldStartLoadWithRequest = useCallback(
    (request) => {
      const url = (request?.url || '').trim();
      if (!url) return true;
      if (isPaymentReturnUrl(url)) {
        handlePaymentReturnUrl(url);
        return false;
      }
      const lower = url.toLowerCase();
      if (lower.startsWith('http://') || lower.startsWith('https://')) {
        return isAllowedCheckoutUrl(url);
      }
      return false;
    },
    [handlePaymentReturnUrl]
  );

  const onNavigationStateChange = useCallback(
    (navState) => {
      const url = (navState?.url || '').trim();
      if (url && isPaymentReturnUrl(url)) {
        handlePaymentReturnUrl(url);
      }
    },
    [handlePaymentReturnUrl]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.contentBackground }]}>
      <BrandYellowStrip />

      <View style={[styles.header, { backgroundColor: colors.elevatedSurface, borderBottomColor: colors.border }]}>
        <Text
          style={[styles.headerTitle, { color: colors.textSecondary, fontFamily: appTypography.bold }]}
          numberOfLines={1}
        >
          Pay securely
        </Text>
      </View>

      {checkoutClosed ? (
        <View style={[styles.webLoading, { paddingBottom: insets.bottom }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : verifying ? (
        <View style={[styles.webLoading, { paddingBottom: insets.bottom }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text
            style={[
              styles.loadingHint,
              { color: colors.textSecondary, fontFamily: appTypography.regular },
            ]}
          >
            Verifying your payment…
          </Text>
        </View>
      ) : mode === MODE.UNAVAILABLE ? (
        <View style={[styles.fallback, { paddingBottom: insets.bottom }]}>
          <Text style={{ color: colors.textSecondary, textAlign: 'center', padding: 24 }}>
            Could not start checkout. Go back and try Place Order again.
          </Text>
        </View>
      ) : SDK_MODES.includes(mode) ? (
        <View style={[styles.webLoading, { paddingBottom: insets.bottom }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text
            style={[
              styles.loadingHint,
              { color: colors.textSecondary, fontFamily: appTypography.regular },
            ]}
          >
            Opening secure payment…
          </Text>
        </View>
      ) : webViewSource ? (
        <View style={[styles.webWrap, { marginBottom: insets.bottom }]}>
          <WebView
            ref={webRef}
            key={webviewKey}
            style={styles.web}
            source={webViewSource}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled={Platform.OS === 'android'}
            sharedCookiesEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={styles.webLoading}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text
                  style={[
                    styles.loadingHint,
                    { color: colors.textSecondary, fontFamily: appTypography.regular },
                  ]}
                >
                  Loading secure payment…
                </Text>
              </View>
            )}
            setSupportMultipleWindows={false}
            originWhitelist={['https://*', 'http://*', 'hungertap://*']}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            onNavigationStateChange={onNavigationStateChange}
          />
        </View>
      ) : (
        <View style={[styles.fallback, { paddingBottom: insets.bottom }]}>
          <Text style={{ color: colors.textSecondary, textAlign: 'center', padding: 24 }}>
            Missing payment link. Go back and try Place Order again.
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    textAlign: 'center',
    fontSize: 20,
  },
  webWrap: { flex: 1 },
  web: { flex: 1 },
  webLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingHint: {
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  fallback: { flex: 1, justifyContent: 'center' },
});

export default PaymentProcessingScreen;
