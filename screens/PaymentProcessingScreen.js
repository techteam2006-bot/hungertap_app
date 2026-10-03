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
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useTheme } from '../lib/ThemeContext';
import BrandYellowStrip from '../components/BrandYellowStrip';
import AppIcon from '../components/AppIcon';
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
  triggerGatewayCheckoutCancel,
  cancelOwnPendingPayment,
  abandonCheckoutPayment,
} from '../lib/cancelCheckoutPayment';
import {
  isCashfreeNativeSdkAvailable,
  describeCashfreeSdkAvailability,
  describeCashfreeSdkError,
  isCashfreeUserCancelError,
  isCashfreeLaunchFailureError,
  configureCashfreeCallbacks,
  clearCashfreeCallbacks,
  startCashfreeCheckout,
  isCashfreeElementSdkAvailable,
} from '../lib/cashfreeCheckout';
import {
  isEasebuzzNativeSdkAvailable,
  startEasebuzzCheckout,
} from '../lib/easebuzzCheckout';
import {
  isRazorpayNativeSdkAvailable,
  describeRazorpaySdkAvailability,
  isRazorpayLaunchFailureError,
  startRazorpayCheckout,
} from '../lib/razorpayCheckout';
import { postVerifyRazorpayPayment } from '../lib/verifyRazorpayPayment';
import { CONFIG } from '../config';
import CashfreeCheckoutSheet from '../components/cashfree/CashfreeCheckoutSheet';
import { USE_CUSTOM_CASHFREE_UI } from '../lib/cashfreeUiTheme';

/**
 * Order-status polling. Every poll is one PostgREST request, and the backend
 * has a small connection budget (~60), so: never more than ONE status request
 * in flight per phone, and poll slowly while the payer is only choosing a
 * payment method.
 */
const POLL_MS = 3000; // payment in progress
const POLL_IDLE_MS = 15000; // custom Cashfree UI open, no payment started yet
const VERIFY_POLL_MS = 1500; // after the gateway says "done", until the webhook lands
const VERIFY_WINDOW_MS = 30000;
const STUCK_MS = 180000;
/**
 * Wait this long for native SDK UI to present before treating it as a launch
 * failure (Cashfree/Easebuzz: back to cart; Razorpay: WebView fallback).
 * Once the SDK reports that checkout opened (or doPayment returns), the timer
 * must not fire — otherwise a slow payer gets a second checkout after cancel/pay.
 */
const SDK_FALLBACK_MS = 30000;
const WEBVIEW_OVERLAY_MAX_MS = 5000;
/** Ignore transient order statuses while checkout is still opening. */
const CHECKOUT_LAUNCH_GRACE_MS = 8000;

/**
 * Cashfree and Easebuzz are native-SDK only (no hosted/WebView fallback).
 * Razorpay still falls back to WebView when its native module is unavailable.
 */
const MODE = {
  CASHFREE_SDK: 'cashfree-sdk',
  EASEBUZZ_SDK: 'easebuzz-sdk',
  EASEBUZZ_WEBVIEW: 'easebuzz-webview',
  RAZORPAY_SDK: 'razorpay-sdk',
  RAZORPAY_WEBVIEW: 'razorpay-webview',
  UNAVAILABLE: 'unavailable',
  /** Payment SDK is not in this build (Expo Go / outdated APK) — no web fallback. */
  SDK_MISSING: 'sdk-missing',
};

const SDK_MODES = [MODE.CASHFREE_SDK, MODE.EASEBUZZ_SDK, MODE.RAZORPAY_SDK];

function canUseRazorpayWebViewFallback({
  activePaymentUrl,
  razorpayKeyId,
  razorpayOrderId,
  razorpayAmountPaise,
}) {
  if (isAllowedCheckoutUrl(activePaymentUrl)) return true;
  return !!(razorpayKeyId && razorpayOrderId && razorpayAmountPaise);
}

function resolveInitialCheckoutMode({
  isCashfree,
  isRazorpay,
  cashfreeSessionId,
  activePaymentSessionId,
  activePaymentUrl,
  razorpayKeyId,
  razorpayOrderId,
  razorpayAmountPaise,
}) {
  if (isRazorpay) {
    const webOk = canUseRazorpayWebViewFallback({
      activePaymentUrl,
      razorpayKeyId,
      razorpayOrderId,
      razorpayAmountPaise,
    });
    if (!webOk) return MODE.UNAVAILABLE;
    if (isRazorpayNativeSdkAvailable()) return MODE.RAZORPAY_SDK;
    return MODE.RAZORPAY_WEBVIEW;
  }

  // Cashfree and Easebuzz are native-SDK only — no hosted WebView fallback.
  if (isCashfree) {
    if (!cashfreeSessionId) return MODE.UNAVAILABLE;
    if (isCashfreeNativeSdkAvailable()) return MODE.CASHFREE_SDK;
    return MODE.SDK_MISSING;
  }

  if (!activePaymentSessionId) return MODE.UNAVAILABLE;
  if (isEasebuzzNativeSdkAvailable()) return MODE.EASEBUZZ_SDK;
  const ebUrl = activePaymentUrl || (
    activePaymentSessionId
      ? (String(environment || '').toUpperCase() === 'PRODUCTION'
          ? `https://pay.easebuzz.in/pay/${activePaymentSessionId}`
          : `https://testpay.easebuzz.in/pay/${activePaymentSessionId}`)
      : ''
  );
  if (isAllowedCheckoutUrl(ebUrl)) return MODE.EASEBUZZ_WEBVIEW;
  return MODE.SDK_MISSING;
}

/** Cashfree session ids are interpolated into a <script> tag — validate, never trust. */
const CASHFREE_SESSION_RE = /^session_[A-Za-z0-9_-]{10,400}$/;
const CASHFREE_SESSION_FALLBACK_RE = /^[A-Za-z0-9_-]{10,400}$/;

function normalizeCashfreeSessionId(raw) {
  const s = String(raw || '').trim();
  if (CASHFREE_SESSION_RE.test(s) || CASHFREE_SESSION_FALLBACK_RE.test(s)) return s;
  return '';
}

/** Escape values embedded in Razorpay WebView HTML. */
function escapeWebEmbed(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\u003c');
}

/**
 * In-app Razorpay checkout.js fallback when the native module is unavailable or
 * blocked (Expo Go, sideloaded APK Play Store check, init failure).
 */
function buildRazorpayWebJsSdkHtml(keyId, razorpayOrderId, amountPaise, orderUuid, paymentId) {
  const key = escapeWebEmbed(keyId);
  const orderId = escapeWebEmbed(razorpayOrderId);
  const amount = escapeWebEmbed(amountPaise);
  const appOrderId = escapeWebEmbed(orderUuid);
  const payId = escapeWebEmbed(paymentId);

  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <style>
      body {
        margin: 0; padding: 0;
        background-color: #FFFFFF; color: #1A1A1A;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        display: flex; align-items: center; justify-content: center; height: 100vh;
      }
      .spinner {
        width: 40px; height: 40px;
        border: 4px solid rgba(0,0,0,0.08); border-left-color: #FFB301;
        border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px auto;
      }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div style="text-align:center;">
      <div class="spinner"></div>
      <div style="font-size:16px;font-weight:600;color:#1A1A1A;margin-bottom:4px;">Checkout</div>
      <div style="font-size:14px;color:#666666;">Opening secure payment…</div>
    </div>
    <script>
      (function () {
        function openCheckout() {
          if (!window.Razorpay) return;
          var options = {
            key: "${key}",
            amount: "${amount}",
            currency: "INR",
            order_id: "${orderId}",
            name: "HungerTap",
            description: "HungerTap order",
            theme: { color: "#FFB301" },
            notes: { order_id: "${appOrderId}", payment_id: "${payId}" },
            handler: function () {
              window.location.href = "hungertap://payment-success";
            },
            modal: {
              ondismiss: function () {
                window.location.href = "hungertap://payment-cancel";
              }
            }
          };
          try {
            var rzp = new Razorpay(options);
            rzp.on("payment.failed", function () {
              window.location.href = "hungertap://payment-failure";
            });
            rzp.open();
          } catch (e) {
            console.error("Razorpay checkout error:", e);
          }
        }
        var sdkScript = document.querySelector('script[src*="checkout.razorpay.com"]');
        if (window.Razorpay) {
          openCheckout();
        } else if (sdkScript) {
          sdkScript.addEventListener("load", openCheckout);
          sdkScript.addEventListener("error", function () {
            console.error("Razorpay SDK script failed to load");
          });
        } else {
          setTimeout(openCheckout, 1500);
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
  return (
    mode === MODE.EASEBUZZ_WEBVIEW ||
    mode === MODE.RAZORPAY_WEBVIEW
  );
}

/**
 * Fall back from native SDK to WebView only when the SDK never reported that
 * checkout UI opened. Paying or cancelling after open must not reopen WebView.
 */
function useGatewayLaunchFallback({
  mode,
  isCashfree,
  isRazorpay,
  activePaymentUrl,
  activePaymentSessionId,
  environment,
  sdkUiPresentedRef,
  handleCashfreeLaunchFailure,
  switchToEasebuzzWebViewFallback,
  handleEasebuzzLaunchFailure,
  switchToRazorpayWebViewFallback,
  onSdkLaunchTimeout,
}) {
  useEffect(() => {
    if (!SDK_MODES.includes(mode)) return undefined;

    const timer = setTimeout(() => {
      if (sdkUiPresentedRef?.current) return;
      if (isCashfree) {
        handleCashfreeLaunchFailure?.();
        return;
      }
      if (isRazorpay || mode === MODE.RAZORPAY_SDK) {
        switchToRazorpayWebViewFallback?.();
        return;
      }
      const ebUrl = activePaymentUrl || (
        activePaymentSessionId
          ? (String(environment || '').toUpperCase() === 'PRODUCTION'
              ? `https://pay.easebuzz.in/pay/${activePaymentSessionId}`
              : `https://testpay.easebuzz.in/pay/${activePaymentSessionId}`)
          : ''
      );
      if (isAllowedCheckoutUrl(ebUrl)) {
        switchToEasebuzzWebViewFallback?.();
        return;
      }
      handleEasebuzzLaunchFailure?.();
    }, SDK_FALLBACK_MS);

    return () => clearTimeout(timer);
  }, [
    mode,
    isCashfree,
    isRazorpay,
    activePaymentUrl,
    activePaymentSessionId,
    environment,
    sdkUiPresentedRef,
    handleCashfreeLaunchFailure,
    switchToEasebuzzWebViewFallback,
    handleEasebuzzLaunchFailure,
    switchToRazorpayWebViewFallback,
    onSdkLaunchTimeout,
  ]);
}

/**
 * Map a native SDK result onto the same outcomes `parsePaymentReturnUrl` yields
 * for the WebView flow. Advisory only — the `orders` row stays authoritative and
 * is still polled throughout.
 * @returns {'success'|'cancelled'|'failure'}
 */
function mapGatewaySdkResult(payload) {
  if (!payload) return 'failure';
  if (typeof payload === 'string') {
    const s = payload.toLowerCase();
    if (s.includes('payment_success') || s.includes('success') || s.includes('txn_success')) return 'success';
    if (s.includes('cancel') || s.includes('back_press') || s.includes('dropped') || s.includes('user_cancelled')) return 'cancelled';
    return 'failure';
  }
  const result = String(payload?.result ?? '').toLowerCase();
  const status = String(payload?.payment_response?.status ?? payload?.status ?? '').toLowerCase();
  const s = `${result} ${status}`;

  if (s.includes('payment_success') || s.includes('success') || s.includes('txn_success')) return 'success';
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
    takeawayCharge = 0,
    discountAmount = 0,
    offerCode = '',
    razorpayKeyId: initialRazorpayKeyId = '',
    razorpayOrderId: initialRazorpayOrderId = '',
    razorpayAmountPaise: initialRazorpayAmountPaise = '',
  } = route.params || {};

  const applyOutcomeRef = useRef(null);

  const finalizedRef = useRef(false);
  const stuckTimerRef = useRef(null);
  const pollOnceRef = useRef(null);
  const webRef = useRef(null);
  const cancelInFlightRef = useRef(false);
  const allowLeaveRef = useRef(false);
  const blockExitRef = useRef(true);
  const sdkStartedRef = useRef(false);
  /** True once native checkout UI presented (or launch was accepted). */
  const sdkUiPresentedRef = useRef(false);
  const checkoutOpenedAtRef = useRef(Date.now());
  const webViewFallbackRequestedRef = useRef(false);
  /** Cashfree/Easebuzz launch failure already shown to the payer. */
  const launchFailureHandledRef = useRef(false);
  /** Custom HungerTap Cashfree UI (components/cashfree/CashfreeCheckoutSheet) is showing. */
  const cfCustomUiRef = useRef(false);
  /** A payment was launched from the custom UI and has not reported back yet. */
  const cfProcessingRef = useRef(false);
  /** Cashfree's error message for the failed screen. */
  const cfLastErrorRef = useRef('');
  const [cfCustomUi, setCfCustomUi] = useState(false);
  /** Failure pushed into the custom UI: { key, status: 'failed', message }. */
  const [cfAttempt, setCfAttempt] = useState(null);
  /** One order-status request at a time (see refreshPaymentStatus). */
  const statusInFlightRef = useRef(false);
  const verifyingRef = useRef(false);

  const [checkoutOrderId] = useState(() => String(initialOrderId || '').trim());
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
  const [webviewKey, setWebviewKey] = useState(0);
  const webViewReadyRef = useRef(false);
  const bumpWebViewKey = useCallback(() => {
    webViewReadyRef.current = false;
    setWebviewKey((k) => k + 1);
  }, []);
  const [verifying, setVerifying] = useState(false);
  const [showVerifyCancel, setShowVerifyCancel] = useState(false);
  const [webViewLoaded, setWebViewLoaded] = useState(false);
  const [blockExit, setBlockExit] = useState(true);

  useEffect(() => {
    if (!verifying) {
      setShowVerifyCancel(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setShowVerifyCancel(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [verifying]);

  useEffect(() => {
    blockExitRef.current = blockExit;
  }, [blockExit]);

  const isCashfree = gateway === 'cashfree';
  const isRazorpay = gateway === 'razorpay';
  const razorpayKeyId = String(initialRazorpayKeyId || '').trim();
  const razorpayOrderId = String(initialRazorpayOrderId || '').trim();
  const razorpayAmountPaise = String(initialRazorpayAmountPaise || '').trim();
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
      isRazorpay,
      cashfreeSessionId: normalizeCashfreeSessionId(
        initialPaymentSessionId != null ? String(initialPaymentSessionId).trim() : ''
      ),
      activePaymentSessionId:
        initialPaymentSessionId != null ? String(initialPaymentSessionId).trim() : '',
      activePaymentUrl: String(initialPaymentUrl || '').trim(),
      razorpayKeyId: String(initialRazorpayKeyId || '').trim(),
      razorpayOrderId: String(initialRazorpayOrderId || '').trim(),
      razorpayAmountPaise: String(initialRazorpayAmountPaise || '').trim(),
    })
  );

  const webViewSource = useMemo(() => {
    if (mode === MODE.EASEBUZZ_WEBVIEW) {
      const url = activePaymentUrl || (
        activePaymentSessionId
          ? (String(environment || '').toUpperCase() === 'PRODUCTION'
              ? `https://pay.easebuzz.in/pay/${activePaymentSessionId}`
              : `https://testpay.easebuzz.in/pay/${activePaymentSessionId}`)
          : ''
      );
      if (isAllowedCheckoutUrl(url)) return { uri: url };
      return null;
    }
    // Razorpay WebView checkout fallback
    if (mode === MODE.RAZORPAY_WEBVIEW) {
      const url = String(activePaymentUrl || '').trim();
      if (isAllowedCheckoutUrl(url)) return { uri: url };
      if (razorpayKeyId && razorpayOrderId && razorpayAmountPaise) {
        return {
          html: buildRazorpayWebJsSdkHtml(
            razorpayKeyId,
            razorpayOrderId,
            razorpayAmountPaise,
            checkoutOrderId,
            activePaymentId
          ),
          baseUrl: 'https://api.razorpay.com',
        };
      }
      return null;
    }
    return null;
  }, [
    mode,
    activePaymentUrl,
    activePaymentSessionId,
    environment,
    razorpayKeyId,
    razorpayOrderId,
    razorpayAmountPaise,
    checkoutOrderId,
    activePaymentId,
  ]);

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
      paymentMethod: gateway === 'cashfree' ? 'cashfree' : gateway === 'razorpay' ? 'razorpay' : 'easebuzz_v2',
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
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    allowLeaveRef.current = true;
    blockExitRef.current = false;
    setBlockExit(false);
    if (stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = null;
    }
    if (cfCustomUiRef.current) {
      // Custom Cashfree UI shows its own "Payment failed" screen (Back to cart).
      setCfAttempt({
        key: Date.now(),
        status: 'failed',
        message: cfLastErrorRef.current || 'The payment could not be completed.',
      });
      return;
    }
    Alert.alert(
      'Payment failed',
      'Your payment could not be completed. Return to cart to place the order again.',
      [
        {
          text: 'OK',
          onPress: () => {
            resetNavigationToCart(navigation);
          },
        },
      ],
      { cancelable: false }
    );
  }, [navigation]);

  /**
   * Cashfree / Easebuzz are SDK-only: when the native checkout cannot open,
   * cancel this (unpaid) order and send the payer back to the cart with a
   * clear message instead of loading a hosted payment page.
   */
  const failSdkLaunch = useCallback(
    (gatewayLabel) => {
      if (finalizedRef.current || launchFailureHandledRef.current) return;
      // Never interrupt a checkout the SDK already showed — its own callbacks decide.
      if (sdkUiPresentedRef.current) return;
      launchFailureHandledRef.current = true;
      sdkStartedRef.current = false;
      Alert.alert(
        'Payment could not start',
        `${gatewayLabel} payment could not open on this phone. You have not been charged. Please check your internet and try again from the cart. If it keeps happening, update HungerTap from the Play Store.`,
        [{ text: 'Back to cart', onPress: () => finalizeCancel({ fromGateway: false }) }],
        { cancelable: false }
      );
    },
    [finalizeCancel]
  );

  const handleCashfreeLaunchFailure = useCallback(() => failSdkLaunch('Cashfree'), [failSdkLaunch]);
  const handleEasebuzzLaunchFailure = useCallback(() => failSdkLaunch('Easebuzz'), [failSdkLaunch]);

  const switchToEasebuzzWebViewFallback = useCallback(() => {
    if (finalizedRef.current || sdkUiPresentedRef.current) return;
    sdkStartedRef.current = false;
    bumpWebViewKey();
    const ebUrl = activePaymentUrl || (
      activePaymentSessionId
        ? (String(environment || '').toUpperCase() === 'PRODUCTION'
            ? `https://pay.easebuzz.in/pay/${activePaymentSessionId}`
            : `https://testpay.easebuzz.in/pay/${activePaymentSessionId}`)
        : ''
    );
    setMode(isAllowedCheckoutUrl(ebUrl) ? MODE.EASEBUZZ_WEBVIEW : MODE.UNAVAILABLE);
  }, [activePaymentUrl, activePaymentSessionId, environment, bumpWebViewKey]);

  const switchToRazorpayWebViewFallback = useCallback(() => {
    if (finalizedRef.current || webViewFallbackRequestedRef.current) return;
    if (sdkUiPresentedRef.current) return;
    if (
      !canUseRazorpayWebViewFallback({
        activePaymentUrl,
        razorpayKeyId,
        razorpayOrderId,
        razorpayAmountPaise,
      })
    ) {
      return;
    }
    webViewFallbackRequestedRef.current = true;
    sdkStartedRef.current = false;
    sdkUiPresentedRef.current = false;
    bumpWebViewKey();
    setMode(MODE.RAZORPAY_WEBVIEW);
  }, [
    activePaymentUrl,
    razorpayKeyId,
    razorpayOrderId,
    razorpayAmountPaise,
    bumpWebViewKey,
  ]);

  useGatewayLaunchFallback({
    mode,
    isCashfree,
    isRazorpay,
    activePaymentUrl,
    activePaymentSessionId,
    environment,
    sdkUiPresentedRef,
    handleCashfreeLaunchFailure,
    switchToEasebuzzWebViewFallback,
    handleEasebuzzLaunchFailure,
    switchToRazorpayWebViewFallback,
    onSdkLaunchTimeout: () => applyOutcomeRef.current?.('failure'),
  });

  /** Hardware / nav back: cancel silently (no confirm dialog) and leave checkout. */
  const promptAbandonCheckout = useCallback(() => {
    if (finalizedRef.current || cancelInFlightRef.current) return true;
    finalizeCancel({ fromGateway: false });
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
      const inLaunchGrace =
        !sdkUiPresentedRef.current &&
        Date.now() - checkoutOpenedAtRef.current < CHECKOUT_LAUNCH_GRACE_MS;
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
    // Single-flight: on a weak network a request can take many seconds — never stack them.
    if (statusInFlightRef.current) return;
    statusInFlightRef.current = true;
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
    } finally {
      statusInFlightRef.current = false;
    }
  }, [checkoutOrderId, userId, applyOrderStatus]);

  pollOnceRef.current = refreshPaymentStatus;
  verifyingRef.current = verifying;

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

      // User cancel / post-open failure must never reopen WebView. Fallback is
      // only for Expo / missing native module / launch failure before UI opens
      // (handled by onError launch path, launchFailed, and the gated timer).
      if (outcome === 'cancelled') {
        finalizeCancel({ fromGateway: true });
        return;
      }
      finalizeFailure();
    },
    [refreshPaymentStatus, finalizeCancel, finalizeFailure]
  );

  // While verifying: the main poll loop speeds up to VERIFY_POLL_MS (single-flight).
  // This effect only kicks off an immediate check and shows the "taking longer"
  // message if the webhook hasn't settled the order within VERIFY_WINDOW_MS.
  useEffect(() => {
    if (!verifying || finalizedRef.current) return undefined;
    refreshPaymentStatus();
    const timer = setTimeout(() => {
      if (finalizedRef.current) return;
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
    }, VERIFY_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [verifying, refreshPaymentStatus, navigation]);

  // Held in a ref so the async SDK effects below never re-run (and never drop a
  // pending gateway result) just because a callback identity changed.
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
        const userCancelled = isCashfreeUserCancelError(error);
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          // eslint-disable-next-line no-console
          console.warn(
            `[Cashfree] SDK onError (${userCancelled ? 'user cancelled' : 'launch/session failure'}):`,
            describeCashfreeSdkError(error)
          );
        }
        // The orders row is authoritative — a late webhook may already have
        // settled this payment, so check before acting on the SDK's verdict.
        pollOnceRef.current?.();

        if (cfCustomUiRef.current) {
          cfProcessingRef.current = false;
          try {
            cfLastErrorRef.current =
              typeof error?.getMessage === 'function' ? String(error.getMessage() || '') : String(error?.message || '');
          } catch (_) {
            cfLastErrorRef.current = '';
          }
        }

        if (userCancelled) {
          applyOutcomeRef.current?.('cancelled');
          return;
        }
        if (isCashfreeLaunchFailureError(error)) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            // eslint-disable-next-line no-console
            console.warn(
              '[Cashfree] Native SDK launch blocked — returning to cart:',
              describeCashfreeSdkError(error)
            );
          }
          sdkUiPresentedRef.current = false;
          sdkStartedRef.current = false;
          handleCashfreeLaunchFailure();
          return;
        }
        // Launch/session error before UI presented → back to cart. After present → fail.
        if (sdkUiPresentedRef.current) {
          applyOutcomeRef.current?.('failure');
          return;
        }
        handleCashfreeLaunchFailure();
      },
    });

    if (!sdkStartedRef.current && USE_CUSTOM_CASHFREE_UI && isCashfreeElementSdkAvailable()) {
      // Show HungerTap's own payment screens; each method launches its own SDK call.
      sdkStartedRef.current = true;
      sdkUiPresentedRef.current = true; // our UI is up — the 30s launch-failure timer must not fire
      cfCustomUiRef.current = true;
      setCfCustomUi(true);
    }

    if (!sdkStartedRef.current) {
      sdkStartedRef.current = true;
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('📱 [Step 5/7] [PaymentProcessingScreen] Launching Cashfree native SDK. Environment:', environment);
      }
      try {
        startCashfreeCheckout({
          paymentSessionId: cashfreeSessionId,
          orderId: cashfreeOrderId || checkoutOrderId,
          environment,
        });
        // doPayment returned — assume launch accepted; launch-failure onError resets this.
        sdkUiPresentedRef.current = true;
      } catch (e) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[Cashfree] startCashfreeCheckout failed — returning to cart:', e?.message || e);
        }
        sdkStartedRef.current = false;
        sdkUiPresentedRef.current = false;
        handleCashfreeLaunchFailure();
      }
    }

    return () => clearCashfreeCallbacks();
  }, [
    mode,
    cashfreeSessionId,
    cashfreeOrderId,
    checkoutOrderId,
    environment,
    handleCashfreeLaunchFailure,
  ]);

  // --- Native SDK: Easebuzz (SDK only — launch failure returns to cart) -----
  useEffect(() => {
    if (mode !== MODE.EASEBUZZ_SDK || sdkStartedRef.current) return;
    sdkStartedRef.current = true;

    let cancelled = false;
    (async () => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('📱 [Step 5/7] [PaymentProcessingScreen] Launching Easebuzz native SDK. Environment:', environment);
      }

      // Easebuzz awaits until the payer finishes, so mark "presented" as soon as
      // we invoke native open — otherwise the 30s timer would abort mid-pay.
      // launchFailed clears this and returns the payer to the cart.
      sdkUiPresentedRef.current = true;

      const res = await startEasebuzzCheckout({
        accessKey: activePaymentSessionId,
        environment,
      });
      if (cancelled) return;

      if (res.launchFailed) {
        sdkStartedRef.current = false;
        sdkUiPresentedRef.current = false;
        const ebUrl = activePaymentUrl || (
          activePaymentSessionId
            ? (String(environment || '').toUpperCase() === 'PRODUCTION'
                ? `https://pay.easebuzz.in/pay/${activePaymentSessionId}`
                : `https://testpay.easebuzz.in/pay/${activePaymentSessionId}`)
            : ''
        );
        if (isAllowedCheckoutUrl(ebUrl)) {
          bumpWebViewKey();
          setMode(MODE.EASEBUZZ_WEBVIEW);
          return;
        }
        handleEasebuzzLaunchFailure();
        return;
      }

      const outcome = mapGatewaySdkResult(res.payload);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log('🎉 [Step 7/7] Easebuzz SDK result:', res.payload?.result, 'Outcome:', outcome);
      }

      if (outcome === 'cancelled') {
        // Quick safety check: ensure an async webhook hasn't already marked the order paid
        try {
          const { data: ord } = await supabase
            .from('orders')
            .select('status')
            .eq('id', checkoutOrderId)
            .eq('placed_by', userId)
            .maybeSingle();
          if (ord?.status && isOrderPlacedSuccessStatus(ord.status)) {
            finalizeSuccess();
            return;
          }
        } catch (_) {}
        applyOutcomeRef.current?.('cancelled');
        return;
      }

      if (outcome === 'success') {
        applyOutcomeRef.current?.('success');
        return;
      }

      if (outcome === 'failure') {
        // Check for 3-4 seconds to allow late-arriving webhooks before failing
        setVerifying(true);
        let settled = false;
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 1200));
          if (cancelled || finalizedRef.current) return;
          try {
            const { data: ord } = await supabase
              .from('orders')
              .select('status')
              .eq('id', checkoutOrderId)
              .eq('placed_by', userId)
              .maybeSingle();
            if (ord?.status && isOrderPlacedSuccessStatus(ord.status)) {
              settled = true;
              finalizeSuccess();
              return;
            }
          } catch (_) {}
        }
        if (!settled && !finalizedRef.current && !cancelled) {
          finalizeFailure();
        }
        return;
      }

      applyOutcomeRef.current?.('return_to_app');
    })();

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    activePaymentSessionId,
    activePaymentUrl,
    environment,
    bumpWebViewKey,
    handleEasebuzzLaunchFailure,
    checkoutOrderId,
    userId,
    finalizeSuccess,
    finalizeFailure,
  ]);

  // --- Native SDK: Razorpay (WebView fallback when native blocked or unavailable) ---
  useEffect(() => {
    if (mode !== MODE.RAZORPAY_SDK || sdkStartedRef.current) return;
    sdkStartedRef.current = true;

    let cancelled = false;
    (async () => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.log(
          '📱 [Step 5/7] [PaymentProcessingScreen] Launching Razorpay native SDK.',
          describeRazorpaySdkAvailability()
        );
      }

      sdkUiPresentedRef.current = true;

      const res = await startRazorpayCheckout({
        keyId: razorpayKeyId,
        razorpayOrderId,
        amountPaise: razorpayAmountPaise,
        currency: 'INR',
        name: 'HungerTap',
        description: 'HungerTap order',
        notes: {
          order_id: checkoutOrderId,
          payment_id: activePaymentId || '',
        },
      });
      if (cancelled) return;

      if (res.cancelled) {
        applyOutcomeRef.current?.('cancelled');
        return;
      }

      if (res.launchFailed) {
        sdkUiPresentedRef.current = false;
        sdkStartedRef.current = false;
        webViewFallbackRequestedRef.current = false;
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          // eslint-disable-next-line no-console
          console.warn(
            '[Razorpay] Native SDK launch failed — falling back to WebView:',
            res.error || describeRazorpaySdkAvailability()
          );
        }
        switchToRazorpayWebViewFallback();
        return;
      }

      const payload = res.payload || {};
      if (!payload.razorpay_payment_id || !payload.razorpay_signature) {
        applyOutcomeRef.current?.('failure');
        return;
      }

      setVerifying(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token && CONFIG.VERIFY_RAZORPAY_PAYMENT_URL) {
          await postVerifyRazorpayPayment({
            accessToken: session.access_token,
            orderId: checkoutOrderId,
            paymentId: activePaymentId || null,
            razorpayOrderId: payload.razorpay_order_id || razorpayOrderId,
            razorpayPaymentId: payload.razorpay_payment_id,
            razorpaySignature: payload.razorpay_signature,
          });
        }
      } catch (_) {
        /* webhook still authoritative — keep polling */
      }
      applyOutcomeRef.current?.('success');
    })();

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    razorpayKeyId,
    razorpayOrderId,
    razorpayAmountPaise,
    checkoutOrderId,
    activePaymentId,
    switchToRazorpayWebViewFallback,
  ]);

  useEffect(() => {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;
    if (mode === MODE.EASEBUZZ_WEBVIEW) {
      const ebUrl = activePaymentUrl || (
        activePaymentSessionId
          ? (String(environment || '').toUpperCase() === 'PRODUCTION'
              ? `https://pay.easebuzz.in/pay/${activePaymentSessionId}`
              : `https://testpay.easebuzz.in/pay/${activePaymentSessionId}`)
          : ''
      );
      // eslint-disable-next-line no-console
      console.log('📱 [Step 5/7] [PaymentProcessingScreen] Loading Easebuzz payment URL in WebView:', ebUrl);
    } else if (mode === MODE.SDK_MISSING) {
      // eslint-disable-next-line no-console
      console.warn(
        '📱 [PaymentProcessingScreen] Payment SDK missing in this build:',
        isCashfree ? describeCashfreeSdkAvailability() : 'Easebuzz native module not linked'
      );
    } else if (mode === MODE.RAZORPAY_WEBVIEW) {
      // eslint-disable-next-line no-console
      console.log(
        '📱 [Step 5/7] [PaymentProcessingScreen] Razorpay native SDK unavailable — using WebView fallback.',
        isAllowedCheckoutUrl(activePaymentUrl) ? activePaymentUrl : '(inline checkout.js)',
        '| Reason:',
        describeRazorpaySdkAvailability()
      );
    } else if (mode === MODE.UNAVAILABLE && isRazorpay) {
      // eslint-disable-next-line no-console
      console.warn(
        '📱 [PaymentProcessingScreen] Razorpay unavailable:',
        describeRazorpaySdkAvailability()
      );
    }
  }, [mode, activePaymentUrl, activePaymentSessionId, environment, isCashfree, isRazorpay]);

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
    });
    return unsubscribe;
  }, [navigation, checkoutOrderId]);

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
    let stopped = false;
    const nextDelay = () => {
      if (verifyingRef.current) return VERIFY_POLL_MS;
      if (cfCustomUiRef.current && !cfProcessingRef.current) return POLL_IDLE_MS;
      return POLL_MS;
    };
    // Self-scheduling loop: the next poll is only scheduled after the previous
    // one finished, so slow responses can never pile up.
    const pollLoop = async () => {
      if (stopped || finalizedRef.current) return;
      await pollOnceRef.current?.();
      if (!stopped && !finalizedRef.current) pollTimer = setTimeout(pollLoop, nextDelay());
    };
    pollLoop();

    stuckTimerRef.current = setTimeout(() => {
      if (finalizedRef.current) return;
      if (cfCustomUiRef.current && !cfProcessingRef.current) return;
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
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
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

  if (mode === MODE.CASHFREE_SDK && cfCustomUi && !verifying) {
    return (
      <View style={styles.root}>
        <CashfreeCheckoutSheet
          paymentSessionId={cashfreeSessionId}
          orderId={cashfreeOrderId || checkoutOrderId}
          environment={environment}
          orderItems={orderItems}
          orderTotal={orderTotal}
          isTakeaway={isTakeaway}
          takeawayCharge={takeawayCharge}
          discountAmount={discountAmount}
          offerCode={offerCode}
          attempt={cfAttempt}
          onPaymentLaunched={() => {
            cfProcessingRef.current = true;
          }}
          onCancelOrder={promptAbandonCheckout}
          onBackToCart={() => {
            allowLeaveRef.current = true;
            resetNavigationToCart(navigation);
          }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.contentBackground }]}>
      <BrandYellowStrip />

      <View style={[styles.header, { backgroundColor: colors.elevatedSurface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={promptAbandonCheckout}
          accessibilityRole="button"
          accessibilityLabel="Cancel and return to cart"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <AppIcon name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text
          style={[styles.headerTitle, { color: colors.text, fontFamily: appTypography.bold }]}
          numberOfLines={1}
        >
          Checkout
        </Text>
        <View style={styles.headerRightPlaceholder} />
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
          {showVerifyCancel ? (
            <TouchableOpacity
              onPress={promptAbandonCheckout}
              style={[styles.verifyCancelBtn, { borderColor: colors.border }]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.verifyCancelText,
                  { color: colors.textSecondary, fontFamily: appTypography.medium },
                ]}
              >
                Cancel and return to cart
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : mode === MODE.UNAVAILABLE || mode === MODE.SDK_MISSING ? (
        <View style={[styles.fallback, { paddingBottom: insets.bottom }]}>
          <Text style={{ color: colors.textSecondary, textAlign: 'center', padding: 24, fontFamily: appTypography.regular, fontSize: 15 }}>
            {mode === MODE.SDK_MISSING
              ? 'Payments are not supported in this version of HungerTap. Please update the app from the Play Store and try again. You have not been charged.'
              : isRazorpay
                ? 'Razorpay checkout could not start — payment details were missing from the server. Go back and try Place Order again.'
                : 'Checkout could not start — no payment session was returned. Go back and try Place Order again.'}
          </Text>
          <TouchableOpacity
            onPress={promptAbandonCheckout}
            style={[styles.backToCartBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.85}
          >
            <Text style={[styles.backToCartText, { fontFamily: appTypography.bold }]}>Back to cart</Text>
          </TouchableOpacity>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBackBtn: {
    width: 32,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
  },
  headerRightPlaceholder: {
    width: 32,
  },
  verifyCancelBtn: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
  },
  verifyCancelText: {
    fontSize: 14,
    textAlign: 'center',
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
  backToCartBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  backToCartText: { color: '#000000', fontSize: 15 },
});

export default PaymentProcessingScreen;
