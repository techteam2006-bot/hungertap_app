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

const POLL_MS = 2500;
const STUCK_MS = 180000;

const PaymentProcessingScreen = ({ navigation, route }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { clearCart } = useCart();
  const { userId, getSupabaseToken } = useAuth();
  const {
    paymentUrl: initialPaymentUrl,
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

  const [activePaymentUrl] = useState(() => String(initialPaymentUrl || '').trim());
  const [activePaymentId] = useState(
    initialPaymentId != null ? String(initialPaymentId) : ''
  );
  const [webviewKey] = useState(0);
  const [checkoutClosed, setCheckoutClosed] = useState(false);

  const checkoutUri = useMemo(() => {
    const url = String(activePaymentUrl || '').trim();
    return isAllowedCheckoutUrl(url) ? url : '';
  }, [activePaymentUrl]);

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
      paymentMethod: 'easebuzz_v2',
    });
  }, [clearCart, navigation, orderId, orderItems, orderTotal, userId]);

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

  const handlePaymentReturnUrl = useCallback(
    (url) => {
      const outcome = parsePaymentReturnUrl(url);
      if (!outcome) return false;

      if (outcome === 'success') {
        refreshPaymentStatus();
      } else if (outcome === 'cancelled') {
        finalizeCancel();
      } else {
        finalizeFailure();
      }
      return true;
    },
    [refreshPaymentStatus, finalizeCancel, finalizeFailure]
  );

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
      ) : checkoutUri ? (
        <View style={[styles.webWrap, { marginBottom: insets.bottom }]}>
          <WebView
            ref={webRef}
            key={webviewKey}
            style={styles.web}
            source={{ uri: checkoutUri }}
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
            originWhitelist={['https://*', 'hungertap://*']}
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
