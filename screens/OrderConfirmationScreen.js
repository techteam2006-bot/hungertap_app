import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Vibration,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';
import { useTheme } from '../lib/ThemeContext';
import NotificationService from '../lib/NotificationService';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { useCart } from '../lib/CartContext';
import { isValidOrderUuid } from '../lib/checkoutSecurity';
import { resetNavigationToHome, resetNavigationToCart } from '../lib/navigateHome';
import { getFontStyle } from '../lib/utils/fonts';
import BrandYellowStrip from '../components/BrandYellowStrip';
import LoadingSpinner from '../components/LoadingSpinner';

const { width } = Dimensions.get('window');

const OrderConfirmationScreen = ({ navigation, route }) => {
  const { userId } = useAuth();
  const { clearCart } = useCart();
  const insets = useSafeAreaInsets();
  const {
    orderId,
    orderToken: passedOrderToken,
    totalAmount,
    orderItems,
    paymentMethod,
    outcome = 'success',
  } = route.params || {};
  const isFailure = outcome === 'failed' || outcome === 'payment_failed';
  const [token, setToken] = useState(passedOrderToken || '');
  const [tokenLoading, setTokenLoading] = useState(() => !passedOrderToken && Boolean(orderId));
  const cartClearedRef = useRef(false);

  // Safety net: always clear cart on successful payment confirmation.
  useEffect(() => {
    if (isFailure || cartClearedRef.current) return;
    cartClearedRef.current = true;
    clearCart({ silent: true }).catch(() => {});
  }, [isFailure, clearCart]);

  const displayToken = useMemo(
    () => token || passedOrderToken || '—',
    [token, passedOrderToken, orderId]
  );

  const { colors, isDarkMode } = useTheme();

  const iconScale = useRef(new Animated.Value(0.3)).current;
  const iconOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentY = useRef(new Animated.Value(16)).current;

  const resolvedOrderId = orderId || route.params?.id || route.params?.order?.id || null;

  useEffect(() => {
    const fetchOrderToken = async () => {
      if (token || passedOrderToken || !orderId || !userId || !isValidOrderUuid(orderId)) {
        setTokenLoading(false);
        return;
      }
      try {
        setTokenLoading(true);
        const { data, error } = await supabase
          .from('orders')
          .select('order_token')
          .eq('id', orderId)
          .eq('placed_by', userId)
          .single();
        if (error) {
          console.error('RPC Error:', error.message || error);
          return;
        }
        if (!data) {
          console.warn('No data returned');
          return;
        }
        if (data?.order_token) {
          setToken(data.order_token);
        }
      } catch (e) {
        console.error('Error fetching order token for confirmation:', e);
      } finally {
        setTokenLoading(false);
      }
    };
    fetchOrderToken();

    if (!isFailure) {
      Vibration.vibrate([0, 80, 40, 80]);
    }

    const notifyTimeout = setTimeout(async () => {
      try {
        if (isFailure) return;
        if (!resolvedOrderId || !NotificationService.isNotificationsAvailable()) return;
        await NotificationService.sendOrderNotification(
          resolvedOrderId,
          totalAmount,
          orderItems || []
        );
      } catch (error) {
        console.log('Notification from confirmation:', error);
      }
    }, 800);

    Animated.parallel([
      Animated.spring(iconScale, {
        toValue: 1,
        friction: 7,
        tension: 56,
        useNativeDriver: true,
      }),
      Animated.timing(iconOpacity, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 420,
        delay: 120,
        useNativeDriver: true,
      }),
      Animated.timing(contentY, {
        toValue: 0,
        duration: 420,
        delay: 120,
        useNativeDriver: true,
      }),
    ]).start();

    return () => clearTimeout(notifyTimeout);
  }, [displayToken, totalAmount, orderId, orderItems, passedOrderToken, token, resolvedOrderId, isFailure]);

  const handleViewOrderStatus = () => {
    if (resolvedOrderId) {
      navigation.navigate('OrderStatus', {
        orderId: resolvedOrderId,
        fromOrderConfirmation: true,
      });
    } else {
      navigation.navigate('Orders');
    }
  };

  const handleBackToHome = () => {
    if (isFailure) {
      resetNavigationToCart(navigation);
    } else {
      resetNavigationToHome(navigation);
    }
  };

  const heroGradient = isFailure
    ? isDarkMode
      ? ['rgba(239, 68, 68, 0.2)', 'rgba(0, 0, 0, 0)', colors.contentBackground]
      : ['rgba(239, 68, 68, 0.12)', 'rgba(255, 247, 247, 0)', colors.contentBackground]
    : isDarkMode
      ? ['rgba(16, 185, 129, 0.18)', 'rgba(0, 0, 0, 0)', colors.contentBackground]
      : ['rgba(16, 185, 129, 0.12)', 'rgba(255, 247, 237, 0)', colors.contentBackground];

  const summaryRows = isFailure
    ? [
        {
          icon: 'alert-circle-outline',
          label: 'Status',
          value: 'Order not paid',
        },
        {
          icon: 'location',
          label: 'Pickup',
          value: 'Canteen counter',
        },
        {
          icon: 'wallet-outline',
          label: 'Payment',
          value: 'Unsuccessful',
        },
        {
          icon: 'cash-outline',
          label: 'Total',
          value: `₹${totalAmount ?? '—'}`,
          emphasize: true,
        },
      ]
    : [
        {
          icon: 'location',
          label: 'Pickup',
          value: 'Canteen counter',
        },
        {
          icon: 'wallet-outline',
          label: 'Payment',
          value: paymentMethod === 'easebuzz_v2' ? 'Paid online' : 'Pay at pickup',
        },
        {
          icon: 'cash-outline',
          label: 'Total',
          value: `₹${totalAmount ?? '—'}`,
          emphasize: true,
        },
      ];

  const steps = isFailure
    ? [
        {
          icon: 'receipt-outline',
          title: 'Check Orders',
          subtitle: 'See the latest status for this order in your order history.',
        },
        {
          icon: 'cart-outline',
          title: 'Your cart',
          subtitle: 'Items were not cleared — you can change the cart and place a new order if needed.',
        },
        {
          icon: 'help-circle-outline',
          title: 'Need help?',
          subtitle: 'Check Orders for the latest status from the server.',
        },
      ]
    : [
        {
          icon: 'restaurant-outline',
          title: 'Preparing',
          subtitle: 'Your order is being prepared.',
        },
        {
          icon: 'notifications-outline',
          title: 'Stay tuned',
          subtitle: "We'll notify you when items are ready — pickup QR appears when the full order is ready.",
        },
        {
          icon: 'walk-outline',
          title: 'Collect',
          subtitle: 'Pick it up when your order is marked Ready.',
        },
      ];

  const sectionTitleNext = isFailure ? 'What you can do' : 'What happens next';

  return (
    <View style={[styles.root, { backgroundColor: colors.contentBackground }]}>
      <BrandYellowStrip />
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollInner, { paddingBottom: 36 + insets.bottom }]}
      >
        <LinearGradient colors={heroGradient} locations={[0, 0.45, 1]} style={styles.hero}>
          <TouchableOpacity
            style={[styles.backPill, { backgroundColor: colors.elevatedSurface, borderColor: colors.border }]}
            onPress={handleBackToHome}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <AppIcon name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>

          <Animated.View
            style={[
              styles.iconWrap,
              {
                opacity: iconOpacity,
                transform: [{ scale: iconScale }],
              },
            ]}
          >
            <LinearGradient
              colors={isFailure ? colors.errorGradient : colors.successGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.iconCircle, isFailure && { shadowColor: '#EF4444' }]}
            >
              <AppIcon name={isFailure ? 'close' : 'checkmark'} size={44} color="#FFFFFF" />
            </LinearGradient>
          </Animated.View>

          <Text style={[styles.kicker, { color: colors.textTertiary }]}>
            {isFailure ? 'ORDER FAILED' : 'ORDER CONFIRMED'}
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            {isFailure ? 'Order failed' : "You're all set"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {isFailure
              ? 'Payment did not complete, so this order was not confirmed. Check Orders for status, or return to the menu to place a new order.'
              : "We've received your order and the kitchen is on it."}
          </Text>
        </LinearGradient>

        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.elevatedSurface,
              borderColor: colors.itemCardOutline,
              opacity: contentOpacity,
              transform: [{ translateY: contentY }],
            },
          ]}
        >
          <View style={styles.orderIdBlock}>
            <Text style={[styles.orderIdLabel, { color: colors.textTertiary }]}>Token number</Text>
            {tokenLoading ? (
              <View style={styles.tokenLoadingRow} accessibilityLabel="Loading order token">
                <LoadingSpinner size="small" color={colors.primary} />
                <Text style={[styles.orderIdValue, { color: colors.textSecondary, marginLeft: 10 }]}>
                  Loading...
                </Text>
              </View>
            ) : (
              <Text style={[styles.orderIdValue, { color: colors.text }]}>#{displayToken}</Text>
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.divider }]} />

          {summaryRows.map((row, i) => (
            <View
              key={row.label}
              style={[styles.row, i > 0 && styles.rowSpacing]}
            >
              <View style={[styles.rowIcon, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                <AppIcon
                  name={row.icon}
                  size={20}
                  color="#000000"
                />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, { color: colors.textTertiary }]}>{row.label}</Text>
                <Text
                  style={[
                    styles.rowValue,
                    { color: colors.text },
                    row.emphasize && { ...getFontStyle('bold'), fontSize: 17 },
                  ]}
                >
                  {row.value}
                </Text>
              </View>
            </View>
          ))}
        </Animated.View>

        <Animated.View
          style={[
            styles.timelineCard,
            {
              backgroundColor: colors.elevatedSurface,
              borderColor: colors.itemCardOutline,
              opacity: contentOpacity,
              transform: [{ translateY: contentY }],
            },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{sectionTitleNext}</Text>
          {steps.map((step, index) => (
            <View key={step.title} style={styles.stepRow}>
              <View style={styles.stepRail}>
                <View
                  style={[
                    styles.stepDot,
                    {
                      backgroundColor: isFailure ? colors.error : colors.success,
                      borderColor: colors.contentBackground,
                    },
                  ]}
                />
                {index < steps.length - 1 && (
                  <View style={[styles.stepLine, { backgroundColor: colors.divider }]} />
                )}
              </View>
              <View style={styles.stepBody}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>{step.title}</Text>
                <Text style={[styles.stepSub, { color: colors.textSecondary }]}>{step.subtitle}</Text>
              </View>
            </View>
          ))}
        </Animated.View>

        <Animated.View style={[styles.actions, { opacity: contentOpacity }]}>
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={handleViewOrderStatus}
            style={[
              styles.primaryTouch,
              { shadowColor: isFailure ? colors.error : colors.brandYellow },
            ]}
          >
            <LinearGradient
              colors={isFailure ? colors.errorGradient : [colors.brandYellow, '#D4A017']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.primaryBtn}
            >
              <AppIcon name="receipt-outline" size={22} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>{isFailure ? 'View order' : 'Track order'}</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.elevatedSurface }]}
            onPress={handleBackToHome}
            activeOpacity={0.85}
          >
            <AppIcon name="home-outline" size={22} color={colors.primary} />
            <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Back to menu</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topStrip: {
    width: '100%',
  },
  scroll: {
    flex: 1,
  },
  scrollInner: {
    paddingBottom: 36,
  },
  hero: {
    paddingTop: 8,
    paddingHorizontal: 24,
    paddingBottom: 28,
    alignItems: 'center',
  },
  backPill: {
    position: 'absolute',
    top: 8,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    zIndex: 2,
  },
  iconWrap: {
    marginTop: 36,
    marginBottom: 20,
  },
  iconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 14,
  },
  kicker: {
    ...getFontStyle('semiBold'),
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: 8,
  },
  title: {
    ...getFontStyle('bold'),
    fontSize: 28,
    lineHeight: 34,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    ...getFontStyle('regular'),
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: width * 0.88,
  },
  card: {
    marginHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  orderIdBlock: {
    alignItems: 'center',
    marginBottom: 4,
  },
  tokenLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    marginTop: 4,
  },
  orderIdLabel: {
    ...getFontStyle('medium'),
    fontSize: 13,
    marginBottom: 4,
  },
  orderIdValue: {
    ...getFontStyle('bold'),
    fontSize: 32,
    letterSpacing: -0.5,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowSpacing: {
    marginTop: 14,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    ...getFontStyle('medium'),
    fontSize: 12,
    marginBottom: 2,
  },
  rowValue: {
    ...getFontStyle('regular'),
    fontSize: 16,
  },
  timelineCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    ...getFontStyle('bold'),
    fontSize: 18,
    marginBottom: 18,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepRail: {
    width: 24,
    alignItems: 'center',
    marginRight: 12,
    alignSelf: 'stretch',
  },
  stepDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    marginTop: 4,
  },
  stepLine: {
    flex: 1,
    width: 2,
    marginVertical: 4,
    borderRadius: 1,
  },
  stepBody: {
    flex: 1,
    paddingBottom: 20,
  },
  stepTitle: {
    ...getFontStyle('semiBold'),
    fontSize: 16,
    marginBottom: 4,
  },
  stepSub: {
    ...getFontStyle('regular'),
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    paddingHorizontal: 20,
    gap: 12,
  },
  primaryTouch: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 10,
  },
  primaryBtnText: {
    ...getFontStyle('semiBold'),
    color: '#FFFFFF',
    fontSize: 17,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  secondaryBtnText: {
    ...getFontStyle('semiBold'),
    fontSize: 17,
  },
});

export default OrderConfirmationScreen;
