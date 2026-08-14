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
import { supabase, prepareCheckoutOrderArgs } from '../lib/supabase';
import { postCreateOrderV2 } from '../lib/createOrderV2';
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
  triggerGatewayCheckoutCancel,
  cancelOwnPendingPayment,
  abandonCheckoutPayment,
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
/** Wait this long for native SDK UI before falling back to hosted checkout WebView. */
const SDK_FALLBACK_MS = 30000;
const WEBVIEW_OVERLAY_MAX_MS = 5000;
const CHECKOUT_LAUNCH_GRACE_MS = 35000;

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

function resolveInitialCheckoutMode({
  isCashfree,
  cashfreeSessionId,
  activePaymentSessionId,
  activePaymentUrl,
}) {
  if (isCashfree) {
    if (!cashfreeSessionId) return MODE.UNAVAILABLE;
    if (isCashfreeNativeSdkAvailable()) return MODE.CASHFREE_SDK;
    return MODE.CASHFREE_WEBVIEW;
  }

  if (isEasebuzzNativeSdkAvailable() && activePaymentSessionId) {
    return MODE.EASEBUZZ_SDK;
  }
  if (isAllowedCheckoutUrl(activePaymentUrl)) return MODE.EASEBUZZ_WEBVIEW;
  return MODE.UNAVAILABLE;
}

/** Cashfree session ids are interpolated into a <script> tag — validate, never trust. */
const CASHFREE_SESSION_RE = /^session_[A-Za-z0-9_-]{10,400}$/;
const CASHFREE_SESSION_FALLBACK_RE = /^[A-Za-z0-9_-]{10,400}$/;

function normalizeCashfreeSessionId(raw) {
  const s = String(raw || '').trim();
  if (CASHFREE_SESSION_RE.test(s) || CASHFREE_SESSION_FALLBACK_RE.test(s)) return s;
  return '';
}

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
        function startCheckout() {
          try {
            Cashfree({ mode: "${mode}" }).checkout({
              paymentSessionId: "${sessionId}",
              redirectTarget: "_self"
            });
          } catch (e) {
            console.error("Cashfree checkout error:", e);
          }
        }
        var sdkScript = document.querySelector('script[src*="sdk.cashfree.com"]');
        if (window.Cashfree) {
          startCheckout();
        } else if (sdkScript) {
          sdkScript.addEventListener("load", startCheckout);
          sdkScript.addEventListener("error", function () {
            console.error("Cashfree SDK script failed to load");
          });
        } else {
          setTimeout(startCheckout, 1500);
        }
      })();
    </script>
  </body>
</html>`;
}

/** UPI / wallet deep links opened from gateway WebViews on Android. */
const EXTERNAL_PAYMENT_SCHEMES = [
  'upi:',
  'intent:',
  'tez:',
  'gpay:',
  'phonepe:',
  'paytmmp:',
  'bhim:',
  'credpay:',
];

function isExternalPaymentAppUrl(url) {
  const lower = String(url || '').trim().toLowerCase();
  return EXTERNAL_PAYMENT_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

function isWebViewCheckoutMode(mode) {
  return mode === MODE.CASHFREE_WEBVIEW || mode === MODE.EASEBUZZ_WEBVIEW;
}

/** Fall back from native SDK to checkout WebView when SDK UI never appears. */
function useGatewayLaunchFallback({
  mode,
  isCashfree,
  activePaymentUrl,
  switchToCashfreeWebViewFallback,
  switchToEasebuzzWebViewFallback,
}) {
  useEffect(() => {
    if (!SDK_MODES.includes(mode)) return undefined;

    const timer = setTimeout(() => {
      if (isCashfree) {
        switchToCashfreeWebViewFallback?.();
        return;
      }
      if (isAllowedCheckoutUrl(activePaymentUrl)) {
        switchToEasebuzzWebViewFallback?.();
      }
    }, SDK_FALLBACK_MS);

    return () => clearTimeout(timer);
  }, [
    mode,
    isCashfree,
    activePaymentUrl,
    switchToCashfreeWebViewFallback,
    switchToEasebuzzWebViewFallback,
  ]);
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
  const { userId } = useAuth();
  const {
    gateway = 'cashfree',
    paymentUrl: initialPaymentUrl,
    paymentSessionId: initialPaymentSessionId,
    environment: initialEnvironment,
    cashfreeOrderId: initialCashfreeOrderId,
    orderId: initialOrderId,
    paymentId: initialPaymentId,
    orderItems = [],
    orderTotal = 0,
    isTakeaway = false,
  } = route.params || {};

  const finalizedRef = useRef(false);
  const stuckTimerRef = useRef(null);
  const pollOnceRef = useRef(null);
  const webRef = useRef(null);
  const cancelInFlightRef = useRef(false);
  const allowLeaveRef = useRef(false);
  const blockExitRef = useRef(true);
  const sdkStartedRef = useRef(false);
  const checkoutOpenedAtRef = useRef(Date.now());
  const refreshInFlightRef = useRef(false);
  const webViewFallbackRequestedRef = useRef(false);

  const [checkoutOrderId, setCheckoutOrderId] = useState(() => String(initialOrderId || '').trim());
  const [activePaymentUrl] = useState(() => String(initialPaymentUrl || '').trim());
  const [activePaymentId, setActivePaymentId] = useState(
    initialPaymentId != null ? String(initialPaymentId) : ''
  );
  const [activePaymentSessionId, setActivePaymentSessionId] = useState(
    initialPaymentSessionId != null ? String(initialPaymentSessionId).trim() : ''
  );
  const [environment, setEnvironment] = useState(() =>
    String(initialEnvironment || '').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX'
  );
  const [webviewKey, setWebviewKey] = useState(0);
  const webViewReadyRef = useRef(false);
  const bumpWebViewKey = useCallback(() => {
    webViewReadyRef.current = false;
    setWebviewKey((k) => k + 1);
  }, []);
  const [verifying, setVerifying] = useState(false);
  const [refreshingCheckout, setRefreshingCheckout] = useState(false);
  const [webViewLoaded, setWebViewLoaded] = useState(false);
  const [blockExit, setBlockExit] = useState(true);

  useEffect(() => {
    blockExitRef.current = blockExit;
  }, [blockExit]);

  const isCashfree = gateway === 'cashfree';
  const cashfreeOrderId = useMemo(
    () => String(initialCashfreeOrderId || checkoutOrderId || '').trim(),
    [initialCashfreeOrderId, checkoutOrderId]
  );

  const cashfreeSessionId = useMemo(
    () => normalizeCashfreeSessionId(activePaymentSessionId),
    [activePaymentSessionId]
  );

  const [mode, setMode] = useState(() =>
    resolveInitialCheckoutMode({
      isCashfree,
      cashfreeSessionId: normalizeCashfreeSessionId(
        initialPaymentSessionId != null ? String(initialPaymentSessionId).trim() : ''
      ),
      activePaymentSessionId:
        initialPaymentSessionId != null ? String(initialPaymentSessionId).trim() : '',
      activePaymentUrl: String(initialPaymentUrl || '').trim(),
    })
  );

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

  useEffect(() => {
    webViewReadyRef.current = false;
    setWebViewLoaded(false);
  }, [mode, webviewKey, webViewSource]);

  useEffect(() => {
    if (!isWebViewCheckoutMode(mode)) return undefined;
    const timer = setTimeout(() => {
      webViewReadyRef.current = true;
      setWebViewLoaded(true);
    }, WEBVIEW_OVERLAY_MAX_MS);
    return () => clearTimeout(timer);
  }, [mode, webviewKey]);

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
      if (userId && isValidOrderUuid(checkoutOrderId)) {
        const { data: row } = await supabase
          .from('orders')
          .select('order_token, total_amount')
          .eq('id', checkoutOrderId)
          .eq('placed_by', userId)
          .maybeSingle();
        orderToken = row?.order_token != null ? String(row.order_token) : '';
        const ta = row?.total_amount != null ? Number(row.total_amount) : NaN;
        if (Number.isFinite(ta) && ta > 0) total = ta;
      }
    } catch (_) {}

    navigation.replace('OrderConfirmation', {
      orderId: checkoutOrderId,
      orderToken,
      totalAmount: total,
      orderItems,
      paymentMethod: gateway === 'cashfree' ? 'cashfree' : 'easebuzz_v2',
    });
  }, [clearCart, navigation, checkoutOrderId, orderItems, orderTotal, userId, gateway]);

  const leaveCheckout = useCallback(() => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    allowLeaveRef.current = true;
    blockExitRef.current = false;
    setBlockExit(false);
    if (stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = null;
    }
    resetNavigationToCart(navigation);
  }, [navigation]);

  const resolveGatewayCancellation = useCallback(
    ({ fromGateway = false } = {}) =>
      abandonCheckoutPayment({
        supabaseClient: supabase,
        orderId: checkoutOrderId,
        userId,
        webViewRef: webRef,
        fromGateway,
      }),
    [checkoutOrderId, userId]
  );

  const finalizeCancel = useCallback(
    ({ fromGateway = false } = {}) => {
      if (finalizedRef.current || cancelInFlightRef.current) return;
      cancelInFlightRef.current = true;
      allowLeaveRef.current = true;
      blockExitRef.current = false;
      setBlockExit(false);
      leaveCheckout();
      resolveGatewayCancellation({ fromGateway }).catch(() => {});
    },
    [leaveCheckout, resolveGatewayCancellation]
  );

  const finalizeFailure = useCallback(() => {
    leaveCheckout();
  }, [leaveCheckout]);

  const refreshCheckoutSessionForWebView = useCallback(async () => {
    if (refreshInFlightRef.current || finalizedRef.current || !isCashfree) return false;
    refreshInFlightRef.current = true;
    setRefreshingCheckout(true);

    try {
      const oldOrderId = checkoutOrderId;
      if (isValidOrderUuid(oldOrderId)) {
        await cancelOwnPendingPayment({ supabaseClient: supabase, orderId: oldOrderId });
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        Alert.alert('Sign in required', 'Please sign in again to complete payment.');
        return false;
      }

      const args = prepareCheckoutOrderArgs(orderItems, isTakeaway);
      if (!args.ok) {
        Alert.alert('Checkout error', args.error || 'Invalid cart for checkout.');
        return false;
      }

      const v2 = await postCreateOrderV2({
        accessToken: session.access_token,
        items: args.p_items,
        is_takeaway: args.p_is_takeaway,
        gateway_code: gateway,
      });

      if (!v2.ok) {
        Alert.alert('Checkout error', v2.error || 'Could not restart checkout.');
        return false;
      }

      const newSessionId = String(v2.payment_session_id || '').trim();
      const newOrderId = v2.order_id != null ? String(v2.order_id).trim() : '';
      if (!newSessionId || !isValidOrderUuid(newOrderId)) {
        Alert.alert('Checkout error', 'Payment session was not returned. Please try again from the cart.');
        return false;
      }

      setCheckoutOrderId(newOrderId);
      setActivePaymentSessionId(newSessionId);
      setActivePaymentId(v2.payment_id != null ? String(v2.payment_id) : '');
      setEnvironment(
        String(v2.gateway_environment || 'SANDBOX').toUpperCase() === 'PRODUCTION'
          ? 'PRODUCTION'
          : 'SANDBOX'
      );
      checkoutOpenedAtRef.current = Date.now();
      sdkStartedRef.current = false;
      clearCashfreeCallbacks();
      bumpWebViewKey();
      setMode(MODE.CASHFREE_WEBVIEW);
      return true;
    } catch (_) {
      Alert.alert('Checkout error', 'Could not restart checkout. Please try again from the cart.');
      return false;
    } finally {
      refreshInFlightRef.current = false;
      setRefreshingCheckout(false);
    }
  }, [
    isCashfree,
    checkoutOrderId,
    orderItems,
    isTakeaway,
    gateway,
    bumpWebViewKey,
  ]);

  const switchToCashfreeWebViewFallback = useCallback(async () => {
    if (finalizedRef.current || webViewFallbackRequestedRef.current) return;
    webViewFallbackRequestedRef.current = true;
    const ok = await refreshCheckoutSessionForWebView();
    if (!ok && !finalizedRef.current) {
      Alert.alert(
        'Checkout error',
        'Could not open the payment page. Please go back and try Place Order again.',
        [{ text: 'OK', onPress: () => leaveCheckout() }]
      );
    }
  }, [refreshCheckoutSessionForWebView, leaveCheckout]);

  const switchToEasebuzzWebViewFallback = useCallback(() => {
    if (finalizedRef.current) return;
    sdkStartedRef.current = false;
    bumpWebViewKey();
    setMode(isAllowedCheckoutUrl(activePaymentUrl) ? MODE.EASEBUZZ_WEBVIEW : MODE.UNAVAILABLE);
  }, [activePaymentUrl, bumpWebViewKey]);

  useGatewayLaunchFallback({
    mode,
    isCashfree,
    activePaymentUrl,
    switchToCashfreeWebViewFallback,
    switchToEasebuzzWebViewFallback,
  });

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
            finalizeCancel({ fromGateway: false });
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

      // Ignore transient failed/cancel statuses while the gateway UI is still opening.
      const inLaunchGrace = Date.now() - checkoutOpenedAtRef.current < CHECKOUT_LAUNCH_GRACE_MS;
      if (
        inLaunchGrace &&
        (status === 'payment_failed' ||
          status === 'payment_cancelled' ||
          isCancelledLike(status))
      ) {
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
    if (!checkoutOrderId || !userId || !isValidOrderUuid(checkoutOrderId) || finalizedRef.current) return;
    try {
      const { data: ord } = await supabase
        .from('orders')
        .select('status')
        .eq('id', checkoutOrderId)
        .eq('placed_by', userId)
        .maybeSingle();
      if (ord?.status) applyOrderStatus(ord.status);
    } catch (_) {
      /* network — next poll */
    }
  }, [checkoutOrderId, userId, applyOrderStatus]);

  pollOnceRef.current = refreshPaymentStatus;

  /** Shared by the WebView return-URL path and the native SDK callbacks. */
  const applyCheckoutOutcome = useCallback(
    (outcome) => {
      if (outcome === 'success' || outcome === 'return_to_app') {
        // The gateway handed control back but only the webhook knows whether
        // money moved — cover the checkout UI while the order row is polled.
        setVerifying(true);
        refreshPaymentStatus();
        return;
      }

      const inLaunchGrace = Date.now() - checkoutOpenedAtRef.current < CHECKOUT_LAUNCH_GRACE_MS;
      if (inLaunchGrace && (outcome === 'cancelled' || outcome === 'failure')) {
        if (isCashfree) {
          switchToCashfreeWebViewFallback();
          return;
        }
        if (!isCashfree && isAllowedCheckoutUrl(activePaymentUrl)) {
          sdkStartedRef.current = false;
          bumpWebViewKey();
          setMode(MODE.EASEBUZZ_WEBVIEW);
          return;
        }
      }

      if (outcome === 'cancelled') {
        finalizeCancel({ fromGateway: true });
      } else {
        finalizeFailure();
      }
    },
    [
      refreshPaymentStatus,
      finalizeCancel,
      finalizeFailure,
      isCashfree,
      activePaymentUrl,
      bumpWebViewKey,
      switchToCashfreeWebViewFallback,
    ]
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
          console.warn('[Cashfree] SDK onError — trying WebView fallback:', error?.message || error);
        }
        pollOnceRef.current?.();
        switchToCashfreeWebViewFallback();
        return;
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
          orderId: cashfreeOrderId || checkoutOrderId,
          environment,
        });
      } catch (e) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[Cashfree] startCashfreeCheckout failed, falling back to WebView:', e?.message || e);
        }
        sdkStartedRef.current = false;
        switchToCashfreeWebViewFallback();
      }
    }

    return () => clearCashfreeCallbacks();
  }, [
    mode,
    activePaymentSessionId,
    cashfreeOrderId,
    checkoutOrderId,
    environment,
    switchToCashfreeWebViewFallback,
  ]);

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
        sdkStartedRef.current = false;
        bumpWebViewKey();
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
  }, [mode, activePaymentSessionId, activePaymentUrl, environment, bumpWebViewKey]);

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
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current || finalizedRef.current || !blockExitRef.current) {
        return;
      }
      e.preventDefault();
      Alert.alert(
        'Cancel payment?',
        'If you go back now, this payment will be cancelled and you will need to place the order again.',
        [
          { text: 'Stay', style: 'cancel' },
          {
            text: 'OK',
            style: 'destructive',
            onPress: () => {
              cancelInFlightRef.current = true;
              finalizedRef.current = true;
              allowLeaveRef.current = true;
              blockExitRef.current = false;
              setBlockExit(false);
              if (stuckTimerRef.current) {
                clearTimeout(stuckTimerRef.current);
                stuckTimerRef.current = null;
              }
              triggerGatewayCheckoutCancel(webRef);
              cancelOwnPendingPayment({ supabaseClient: supabase, orderId: checkoutOrderId }).catch(() => {});
              navigation.dispatch(e.data.action);
            },
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, resolveGatewayCancellation]);

  useEffect(() => {
    if (!checkoutOrderId || !isValidOrderUuid(checkoutOrderId)) {
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
    checkoutOrderId,
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
      if (isExternalPaymentAppUrl(url)) {
        Linking.openURL(url).catch(() => {});
        return false;
      }
      const lower = url.toLowerCase();
      if (lower.startsWith('https://')) {
        // Gateways redirect to bank / 3DS pages on many domains once checkout starts.
        if (isWebViewCheckoutMode(mode)) return true;
        return isAllowedCheckoutUrl(url);
      }
      if (lower.startsWith('http://')) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          return isWebViewCheckoutMode(mode) || isAllowedCheckoutUrl(url);
        }
        return false;
      }
      return false;
    },
    [handlePaymentReturnUrl, mode]
  );

  const onNavigationStateChange = useCallback(
    (navState) => {
      const url = (navState?.url || '').trim();
      if (url && isPaymentReturnUrl(url)) {
        handlePaymentReturnUrl(url);
      }
      if (navState?.loading === false && url) {
        webViewReadyRef.current = true;
        setWebViewLoaded(true);
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

      {verifying ? (
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
      ) : SDK_MODES.includes(mode) || refreshingCheckout ? (
        <View style={[styles.webLoading, { paddingBottom: insets.bottom }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text
            style={[
              styles.loadingHint,
              { color: colors.textSecondary, fontFamily: appTypography.regular },
            ]}
          >
            {refreshingCheckout ? 'Preparing checkout…' : 'Opening secure payment…'}
          </Text>
        </View>
      ) : webViewSource ? (
        <View style={[styles.webWrap, { marginBottom: insets.bottom }]}>
          {!webViewLoaded ? (
            <View style={[styles.webLoadingOverlay, styles.webLoading]}>
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
          ) : null}
          <WebView
            ref={webRef}
            key={webviewKey}
            style={styles.web}
            source={webViewSource}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled={Platform.OS === 'android'}
            sharedCookiesEnabled
            startInLoadingState={false}
            mixedContentMode="always"
            javaScriptCanOpenWindowsAutomatically
            setSupportMultipleWindows
            onLoadStart={() => {
              if (!webViewReadyRef.current) setWebViewLoaded(false);
            }}
            onLoadEnd={() => {
              webViewReadyRef.current = true;
              setWebViewLoaded(true);
            }}
            onLoadProgress={({ nativeEvent }) => {
              if (nativeEvent?.progress >= 0.9) {
                webViewReadyRef.current = true;
                setWebViewLoaded(true);
              }
            }}
            originWhitelist={['https://*', 'http://*', 'hungertap://*', 'intent://*', 'upi://*']}
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
  webLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
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
