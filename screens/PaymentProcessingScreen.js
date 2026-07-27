import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useTheme } from '../lib/ThemeContext';
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

const POLL_MS = 2500;
const STUCK_MS = 180000;

const PaymentProcessingScreen = ({ navigation, route }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { clearCart } = useCart();
  const { userId } = useAuth();
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

  const [activePaymentUrl, setActivePaymentUrl] = useState(() =>
    String(initialPaymentUrl || '').trim()
  );
  const [activePaymentId, setActivePaymentId] = useState(
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
    setCheckoutClosed(true);
    if (stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = null;
    }
    resetNavigationToCart(navigation);
  }, [navigation]);

  const finalizeCancel = useCallback(() => {
    leaveCheckout();
  }, [leaveCheckout]);

  const finalizeFailure = useCallback(() => {
    leaveCheckout();
  }, [leaveCheckout]);

  const applyOrderRow = useCallback(
    (status) => {
      if (!status || finalizedRef.current) return;
      if (status === 'preparing' || status === 'ready' || status === 'delivered' || status === 'completed') {
        finalizeSuccess();
        return;
      }
      if (status === 'payment_cancelled') {
        finalizeCancel();
        return;
      }
      if (status === 'cancelled' || status === 'payment_failed') {
        finalizeFailure();
      }
    },
    [finalizeSuccess, finalizeCancel, finalizeFailure]
  );

  const applyPaymentRow = useCallback(
    (status) => {
      if (!status || finalizedRef.current) return;
      const s = String(status).toLowerCase();
      if (s === 'success' || s === 'paid' || s === 'captured') {
        finalizeSuccess();
        return;
      }
      if (s === 'cancelled') {
        finalizeCancel();
        return;
      }
      if (s === 'failed') {
        finalizeFailure();
      }
    },
    [finalizeSuccess, finalizeCancel, finalizeFailure]
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
      if (ord?.status) applyOrderRow(ord.status);

      const payId = activePaymentId;
      if (payId && !finalizedRef.current) {
        const { data: pay } = await supabase
          .from('payments')
          .select('status, order_id')
          .eq('id', payId)
          .maybeSingle();
        if (pay?.order_id && String(pay.order_id) !== String(orderId)) return;
        if (pay?.status) applyPaymentRow(pay.status);
      }
    } catch (_) {
      /* network — next poll */
    }
  }, [orderId, userId, activePaymentId, applyOrderRow, applyPaymentRow]);

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
    if (!orderId || !isValidOrderUuid(orderId)) {
      Alert.alert('Checkout error', 'Missing order reference. Return to the cart and try again.', [
        { text: 'OK', onPress: () => resetNavigationToCart(navigation) },
      ]);
      return;
    }
    if (!userId) {
      Alert.alert('Sign in required', 'Please sign in again to complete payment.', [
        { text: 'OK', onPress: () => navigation.replace('Login') },
      ]);
      return;
    }

    let pollTimer = null;

    const orderChannel = supabase
      .channel(`payment-order-${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => {
          const s = payload.new?.status;
          if (s) applyOrderRow(s);
        }
      )
      .subscribe();

    let payChannel = null;
    if (activePaymentId) {
      payChannel = supabase
        .channel(`payment-row-${activePaymentId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'payments',
            filter: `id=eq.${activePaymentId}`,
          },
          (payload) => {
            const s = payload.new?.status;
            if (s) applyPaymentRow(s);
          }
        )
        .subscribe();
    }

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
      supabase.removeChannel(orderChannel);
      if (payChannel) supabase.removeChannel(payChannel);
      linkSub.remove();
    };
  }, [
    orderId,
    userId,
    activePaymentId,
    applyOrderRow,
    applyPaymentRow,
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
      <View
        style={[
          styles.topStrip,
          {
            height: Math.max(34, insets.top + 12),
            backgroundColor: colors.brandYellow,
          },
        ]}
      />

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
            originWhitelist={['https://*']}
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
  topStrip: {
    width: '100%',
  },
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
