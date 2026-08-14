import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  Dimensions,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AppIcon from '../components/AppIcon';
import BrandYellowStrip from '../components/BrandYellowStrip';
import { pullRefreshControlProps } from '../lib/pullToRefresh';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/ThemeContext';
import { useAuth } from '../lib/AuthContext';
import { useCart } from '../lib/CartContext';
import { supabase, deriveItemIsAvailable } from '../lib/supabase';
import { fetchOrderWithLineJoins, pickLineRowsFromOrderRow } from '../lib/orderQueries';
import {
  getLineSubtotalFromRow,
  getUnitPriceForRow,
  getLineItemIdFromRow,
  resolveOrderHeaderTotalFromRows,
} from '../lib/orderLineRowMoney';
import { appTypography } from '../lib/darkThemeConfig';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Path } from 'react-native-svg';
import QRCodeService from '../lib/QRCodeService';
import PageLoader from '../components/PageLoader';
import LoadingSpinner from '../components/LoadingSpinner';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getOrderStatusColor,
  getOrderStatusLabel,
  getOrderTimelineStep,
  isActiveKitchenStatus,
  isCancelledLike,
  isDeliveredLike,
  isPaymentFailedLike,
  isPartiallyReady,
  isPickupFailed,
  isReorderEligibleStatus,
  canShowPickupQr,
} from '../lib/orderStatus';
import { takeawayChargeForLines } from '../lib/cartRules';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const SUPPORT_EMAIL = 'support@hungertap.online';

const formatStepTime = (isoOrDate) => {
  if (!isoOrDate) return '--';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const timelineStorageKey = (orderId) => `order_timeline_ts_${orderId}`;

/** When line prices are missing but grand total is known (e.g. delivered snapshot), split total by quantity. */
function allocateLineTotalsFromGrandTotal(items, grandTotal) {
  if (!items?.length || !(Number(grandTotal) > 0)) return items || [];
  const quantities = items.map((i) => (Number.isFinite(Number(i.quantity)) ? Number(i.quantity) : 1));
  const qSum = quantities.reduce((a, b) => a + b, 0);
  if (!qSum) return items;
  return items.map((item, idx) => ({
    ...item,
    total_price: grandTotal * (quantities[idx] / qSum),
  }));
}

const OrderStatusScreen = ({ navigation, route }) => {
  const { order, fromOrderConfirmation, orderId: orderIdParam, id: idParam } = route.params || {};
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { addToCart, clearCart, getTotalItems } = useCart();
  const [currentOrder, setCurrentOrder] = useState(order);
  const [orderItems, setOrderItems] = useState([]);
  const [loading, setLoading] = useState(false); // Start with false to avoid loading screen
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOrderSummaryExpanded, setIsOrderSummaryExpanded] = useState(false);
  const isFetchingRef = useRef(false);
  const [profileFullName, setProfileFullName] = useState('');
  const [encryptedQRCode, setEncryptedQRCode] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [priceLookup, setPriceLookup] = useState({});
  const [reordering, setReordering] = useState(false);
  const [initialOrderHydrated, setInitialOrderHydrated] = useState(() => Boolean(order));
  /** Client-side step timestamps recorded as tracking advances. */
  const [stepTimestamps, setStepTimestamps] = useState({});
  const prevStatusRef = useRef(null);
  /** Lock grand total once delivered so realtime/refetch cannot flicker takeaway totals. */
  const deliveredTotalLockRef = useRef(null);

  const parseOrderSummary = useCallback((summary) => {
    if (!summary) return [];
    return String(summary)
      .split(',')
      .map((token) => {
        const trimmed = token.trim();
        if (!trimmed) return null;
        const match = trimmed.match(/^(.*?)(?:\s*[xX]\s*|\s*\()\s*(\d+)\)?$/);
        if (match) {
          const name = match[1].replace(/[()]/g, '').trim();
          const quantity = parseInt(match[2], 10) || 1;
          return { name, quantity };
        }
        return { name: trimmed, quantity: 1 };
      })
      .filter(Boolean);
  }, []);

  useEffect(() => {
    if (order?.items && Array.isArray(order.items)) {
      setOrderItems(order.items);
    } else if (order?.item_name) {
      setOrderItems(parseOrderSummary(order.item_name));
    }
  }, [order, parseOrderSummary]);

  // Resolve a single source of truth for the order id regardless of navigation path
  const resolvedOrderId = orderIdParam || idParam || order?.id;
  console.log('Resolved order ID:', resolvedOrderId, 'User ID:', user?.id);

  // Load + update frontend timeline timestamps as status advances
  useEffect(() => {
    if (!resolvedOrderId || !currentOrder?.status) return;
    let cancelled = false;

    const syncTimestamps = async () => {
      let stored = {};
      try {
        const raw = await AsyncStorage.getItem(timelineStorageKey(resolvedOrderId));
        if (raw) stored = JSON.parse(raw) || {};
      } catch (_) {
        stored = {};
      }
      if (cancelled) return;

      const status = currentOrder.status;
      const nowIso = new Date().toISOString();
      const next = { ...stored };

      if (currentOrder.created_at && !next.placed) {
        next.placed = currentOrder.created_at;
      }

      const stamp = (key, preferred) => {
        if (!next[key]) next[key] = preferred || nowIso;
      };

      if (status === 'preparing' || status === 'confirmed' || status === 'partially_ready') {
        stamp('preparing', currentOrder.updated_at);
      }
      if (status === 'partially_ready') {
        stamp('partially_ready', currentOrder.updated_at);
      }
      if (status === 'ready' || status === 'on_way') {
        stamp('ready', currentOrder.updated_at);
        stamp('partially_ready', currentOrder.updated_at);
      }
      if (status === 'pickup_failed') {
        stamp('ready', currentOrder.updated_at);
        stamp('pickup_failed', currentOrder.updated_at);
      }
      if (status === 'delivered' || status === 'completed' || status === 'paid') {
        stamp('delivered', currentOrder.delivered_at || currentOrder.updated_at);
      }
      if (isCancelledLike(status) || isPaymentFailedLike(status)) {
        stamp('cancelled', currentOrder.updated_at);
      }

      // When status newly changes while screen is open, stamp "now"
      const prev = prevStatusRef.current;
      if (prev && prev !== status) {
        if (status === 'preparing' || status === 'confirmed') next.preparing = nowIso;
        if (status === 'partially_ready') {
          next.preparing = next.preparing || nowIso;
          next.partially_ready = nowIso;
        }
        if (status === 'ready' || status === 'on_way') next.ready = nowIso;
        if (status === 'pickup_failed') {
          next.ready = next.ready || nowIso;
          next.pickup_failed = nowIso;
        }
        if (status === 'delivered' || status === 'completed') {
          next.delivered = currentOrder.delivered_at || nowIso;
        }
        if (isCancelledLike(status) || isPaymentFailedLike(status)) {
          next.cancelled = nowIso;
        }
      }
      prevStatusRef.current = status;

      setStepTimestamps(next);
      AsyncStorage.setItem(timelineStorageKey(resolvedOrderId), JSON.stringify(next)).catch(() => {});
    };

    syncTimestamps();
    return () => {
      cancelled = true;
    };
  }, [
    resolvedOrderId,
    currentOrder?.status,
    currentOrder?.created_at,
    currentOrder?.updated_at,
    currentOrder?.delivered_at,
  ]);

  const handlePaymentSupportContact = useCallback(async () => {
    const orderRef =
      currentOrder?.order_token || currentOrder?.orderNumber || currentOrder?.id || resolvedOrderId || '';
    const subject = orderRef
      ? `Payment issue — Order #${orderRef}`
      : 'Payment issue — HungerTap';
    const body = `Hi HungerTap support,\n\nI need help with a failed payment.\n\nOrder: ${orderRef || '—'}\n\n`;
    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try {
      const canOpen = await Linking.canOpenURL(mailtoUrl);
      if (canOpen) {
        await Linking.openURL(mailtoUrl);
      } else {
        Alert.alert(
          'No email app found',
          `You can reach us at:\n${SUPPORT_EMAIL}`,
          [
            {
              text: 'Copy Email',
              onPress: () => {
                Clipboard.setStringAsync(SUPPORT_EMAIL);
                Alert.alert('Copied!', 'Email address copied to clipboard.');
              },
            },
            { text: 'OK', style: 'cancel' },
          ]
        );
      }
    } catch {
      Alert.alert(
        'No email app found',
        `You can reach us at:\n${SUPPORT_EMAIL}`,
        [
          {
            text: 'Copy Email',
            onPress: () => {
              Clipboard.setStringAsync(SUPPORT_EMAIL);
              Alert.alert('Copied!', 'Email address copied to clipboard.');
            },
          },
          { text: 'OK', style: 'cancel' },
        ]
      );
    }
  }, [currentOrder, resolvedOrderId]);

  // Fetch latest order status from database (silent fetch)
  const fetchLatestOrderStatus = async () => {
    if (!resolvedOrderId || !user?.id) {
      setInitialOrderHydrated(true);
      return;
    }
    if (isFetchingRef.current) return;

    try {
      isFetchingRef.current = true;
      // Remove loading state - fetch silently in background

      const { data, error } = await fetchOrderWithLineJoins(supabase, resolvedOrderId, user.id);

      if (error) {
        console.warn('Error fetching order status:', error?.message || error);
      }
      
      if (data) {
        const orderItemsRows = pickLineRowsFromOrderRow(data);
        const lineDisplayName = (oi) =>
          String(oi?.item_name || oi?.items?.name || 'Item').trim();
        const normalizedLineItems = orderItemsRows.map((oi) => {
          const sub = getLineSubtotalFromRow(oi);
          const unit = getUnitPriceForRow(oi);
          const ip =
            oi?.items?.price != null && Number.isFinite(Number(oi?.items?.price))
              ? Number(oi.items.price)
              : undefined;
          return {
            name: lineDisplayName(oi),
            quantity: Number(oi?.quantity ?? 1) || 1,
            total_price: sub > 0 ? sub : undefined,
            unit_price: unit,
            price: ip,
            item_id: getLineItemIdFromRow(oi),
            status: oi?.status != null ? String(oi.status) : null,
          };
        });
        const counts = {};
        for (const oi of orderItemsRows) {
          const name = lineDisplayName(oi) || 'Item';
          if (!name) continue;
          const quantity = Number(oi?.quantity ?? 1) || 1; // Use quantity from backend
          counts[name] = (counts[name] || 0) + quantity;
        }
        const itemSummaryFromRows = Object.entries(counts)
          .map(([name, qty]) => `${name} (${qty})`)
          .join(', ');

        const deliveredLike =
          data.status === 'delivered' || data.status === 'completed';

        const snapshotName =
          data.item_name != null && String(data.item_name).trim() !== ''
            ? String(data.item_name).trim()
            : null;
        let item_name = snapshotName || itemSummaryFromRows || null;
        let total_amount = resolveOrderHeaderTotalFromRows(data, orderItemsRows);

        // Live delivered still uses order_items until canteen close; history rows
        // already carry item_name / totals from archieved_* / failed_*.
        if (
          deliveredLike &&
          data._historySource === 'archieved' &&
          (!item_name || !(Number.isFinite(total_amount) && total_amount > 0))
        ) {
          // Keep whatever the archive header already provided via `data`
          if (data.item_name != null && String(data.item_name).trim() !== '') {
            item_name = String(data.item_name).trim();
          }
          const at = data.total_amount != null ? Number(data.total_amount) : NaN;
          if (Number.isFinite(at) && at > 0 && !(Number.isFinite(total_amount) && total_amount > 0)) {
            total_amount = Number(at.toFixed(2));
          }
        }

        const normalized = {
          ...data,
          user_id: data.placed_by,
          item_name,
          total_amount,
          orderNumber: data?.order_token || data?.id || resolvedOrderId,
        };
        setCurrentOrder(normalized);
        setOrderItems(
          normalizedLineItems.length > 0
            ? normalizedLineItems
            : parseOrderSummary(normalized.item_name)
        );
        console.log('Fetched order data:', data);
        console.log('Normalized order:', normalized);
        setNotFound(false);
      } else if (!error) {
        // True miss in DB — keep route-hydrated order if navigation passed one
        if (!order) setNotFound(true);
      }
      // On fetch error with no data: keep existing currentOrder (from route params)
    } catch (error) {
      console.warn('Error fetching order status:', error?.message || error);
      if (!order) setNotFound(true);
    } finally {
      isFetchingRef.current = false;
      setInitialOrderHydrated(true);
    }
  };

  // Refresh function
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchLatestOrderStatus();
    } finally {
      setRefreshing(false);
    }
  };

  // Fetch once on mount; Realtime only while this screen is focused.
  useEffect(() => {
    fetchLatestOrderStatus();
  }, [resolvedOrderId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (!resolvedOrderId || !user?.id) return undefined;

      const topic = `order_status_${resolvedOrderId}_${user.id}`;
      const channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'orders',
            filter: `id=eq.${resolvedOrderId}`,
          },
          (payload) => {
            if (payload?.new) fetchLatestOrderStatus();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'orders',
            filter: `id=eq.${resolvedOrderId}`,
          },
          () => {
            fetchLatestOrderStatus();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'order_items',
            filter: `order_id=eq.${resolvedOrderId}`,
          },
          () => {
            fetchLatestOrderStatus();
          }
        )
        .subscribe();

      return () => {
        try {
          supabase.removeChannel(channel);
        } catch (_) {
          try {
            channel.unsubscribe();
          } catch (__) {}
        }
      };
    }, [resolvedOrderId, user?.id])
  );

  // Fetch user's full name (use auth metadata; profiles table may not exist in new backend)
  useEffect(() => {
    if (!user?.id) return;
    const meta = user?.user_metadata || {};
    if (meta.full_name) {
      setProfileFullName(meta.full_name);
      return;
    }
    if (meta.first_name || meta.last_name) {
      setProfileFullName(`${meta.first_name || ''} ${meta.last_name || ''}`.trim());
      return;
    }
    if (user?.email) {
      setProfileFullName(user.email);
    }
  }, [user?.id]);

  // Fetch encrypted QR code (and regenerate if missing)
  useEffect(() => {
    const fetchQRCode = async () => {
      try {
        if (!resolvedOrderId) return;

        setQrLoading(true);

        // Try to fetch encrypted QR code from database
        let { data: qrCode, error } = await QRCodeService.getEncryptedQRCode(resolvedOrderId);

        // If missing, attempt to regenerate and fetch again
        if (error || !qrCode) {
          console.log('⚠️ QR missing or decrypt failed. Regenerating...');
          const tokenForRegen = String(currentOrder?.order_token || resolvedOrderId);
          try {
            await QRCodeService.regenerateQRCode(resolvedOrderId, tokenForRegen);
            const retry = await QRCodeService.getEncryptedQRCode(resolvedOrderId);
            qrCode = retry.data;
          } catch (regenErr) {
            console.log('❌ QR regeneration failed:', regenErr);
          }
        }

        if (qrCode) {
          console.log('✅ QR code ready');
          setEncryptedQRCode(qrCode);
        } else {
          // Fallback to order_token if QR code still not available
          setEncryptedQRCode(String(currentOrder?.order_token || currentOrder?.id));
        }
      } catch (e) {
        console.log('❌ QR fetch exception:', e);
        // Fallback to order_token
        setEncryptedQRCode(String(currentOrder?.order_token || currentOrder?.id));
      } finally {
        setQrLoading(false);
      }
    };

    fetchQRCode();
  }, [resolvedOrderId, currentOrder?.order_token, currentOrder?.id]);

  const parseCurrencyValue = useCallback((rawValue) => {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue;
    }
    if (typeof rawValue === 'string') {
      const normalized = rawValue
        .replace(/[^0-9.,-]/g, '')
        .replace(/,(?=\d{3}(?:[^0-9]|$))/g, '') // remove thousands separator commas
        .replace(',', '.');
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }, []);

  const formatCurrencyValue = useCallback(
    (value) => {
      const numeric = parseCurrencyValue(value);
      if (numeric === null) return '0.00';
      return numeric.toFixed(2);
    },
    [parseCurrencyValue]
  );

  const resolveItemTotal = useCallback(
    (item) => {
      if (!item) return null;
      if (item.total_price !== undefined) {
        const total = parseCurrencyValue(item.total_price);
        if (total !== null) return total;
      }

      const unitRaw = item.unit_price ?? item.price_per_unit ?? item.price;
      const unit = parseCurrencyValue(unitRaw);
      const quantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1;

      const normalizedName = typeof item.name === 'string' ? item.name.trim().toLowerCase() : null;
      if (normalizedName && Object.prototype.hasOwnProperty.call(priceLookup, normalizedName)) {
        const catalogPrice = parseCurrencyValue(priceLookup[normalizedName]);
        if (catalogPrice !== null) {
          return catalogPrice * quantity;
        }
      }

      if (unit !== null) {
        return unit * quantity;
      }

      return null;
    },
    [parseCurrencyValue, priceLookup]
  );

  const computedTotal = useMemo(() => {
    if (!orderItems || orderItems.length === 0) return 0;
    return orderItems.reduce((sum, item) => {
      const itemTotal = resolveItemTotal(item);
      return sum + (itemTotal !== null ? itemTotal : 0);
    }, 0);
  }, [orderItems, resolveItemTotal]);

  useEffect(() => {
    const fetchMissingPrices = async () => {
      if (!orderItems || orderItems.length === 0) return;

      const uniqueNames = Array.from(
        new Set(
          orderItems
            .map((item) => (typeof item?.name === 'string' ? item.name.trim() : ''))
            .filter(Boolean)
        )
      );

      if (uniqueNames.length === 0) return;

      const missing = uniqueNames.filter((name) => {
        const normalized = name.toLowerCase();
        return !Object.prototype.hasOwnProperty.call(priceLookup, normalized);
      });

      if (missing.length === 0) return;

      try {
        const { data, error } = await supabase.from('items').select('name, price').in('name', missing);

        if (error) {
          console.error('RPC Error:', error.message || error);
          return;
        }
        if (!Array.isArray(data)) {
          console.warn('No data returned');
          return;
        }

        setPriceLookup((prev) => {
          const next = { ...prev };
          data.forEach(({ name, price }) => {
            if (!name) return;
            const normalized = String(name).trim().toLowerCase();
            if (normalized) {
              next[normalized] = price;
            }
          });
          return next;
        });
      } catch (err) {
        console.error('Unexpected error fetching prices:', err);
      }
    };

    fetchMissingPrices();
  }, [orderItems, priceLookup]);

  const persistedTotalForLock = parseCurrencyValue(currentOrder?.total_amount);
  const orderIsDeliveredForLock = isDeliveredLike(currentOrder?.status);

  useEffect(() => {
    if (!orderIsDeliveredForLock) {
      deliveredTotalLockRef.current = null;
      return;
    }
    if (
      persistedTotalForLock !== null &&
      Number.isFinite(persistedTotalForLock) &&
      persistedTotalForLock > 0 &&
      (deliveredTotalLockRef.current == null ||
        persistedTotalForLock > deliveredTotalLockRef.current)
    ) {
      deliveredTotalLockRef.current = persistedTotalForLock;
    }
  }, [orderIsDeliveredForLock, persistedTotalForLock]);

  const handleBackPress = () => {
    // Always go back to the previous screen
    navigation.goBack();
  };

  const handleReorderFromOrder = async () => {
    if (!currentOrder?.id || reordering) return;

    const lineRows = pickLineRowsFromOrderRow(currentOrder);
    const itemIds = Array.from(
      new Set(lineRows.map((row) => getLineItemIdFromRow(row)).filter(Boolean))
    );

    if (itemIds.length === 0) {
      Alert.alert('Unable to Reorder', 'No reorderable items were found for this order.');
      return;
    }

    setReordering(true);
    try {
      const { data: itemsData, error } = await supabase
        .from('items')
        .select('id, name, price, image_url, available_stock')
        .in('id', itemIds);

      if (error) {
        throw error;
      }

      const itemById = new Map((itemsData || []).map((item) => [item.id, item]));
      const availableItems = lineRows
        .map((orderItem) => {
          const id = getLineItemIdFromRow(orderItem);
          if (!id) return null;
          const dbItem = itemById.get(id);
          if (!dbItem || !deriveItemIsAvailable(dbItem)) return null;
          return {
            ...dbItem,
            quantity: Number(orderItem.quantity ?? 1) || 1,
          };
        })
        .filter(Boolean);

      if (availableItems.length === 0) {
        Alert.alert('Items Unavailable', 'These items are currently unavailable to reorder.');
        return;
      }

      const applyReorder = async () => {
        await clearCart();
        for (const item of availableItems) {
          await addToCart(item);
        }
        navigation.navigate('Cart');
      };

      if (getTotalItems() > 0) {
        setReordering(false);
        Alert.alert(
          'Replace cart?',
          'Your cart already has items. Clear your current cart and add items from this order instead?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Clear cart & add',
              style: 'destructive',
              onPress: async () => {
                setReordering(true);
                try {
                  await applyReorder();
                } catch (err) {
                  if (__DEV__) {
                    console.error('Reorder failed:', err);
                  }
                  Alert.alert('Reorder Failed', 'Could not update your cart. Please try again.');
                } finally {
                  setReordering(false);
                }
              },
            },
          ]
        );
        return;
      }

      await applyReorder();
    } catch (err) {
      if (__DEV__) {
        console.error('Error reordering order:', err);
      }
      Alert.alert('Reorder Failed', 'Could not add items to cart. Please try again.');
    } finally {
      setReordering(false);
    }
  };

  // Show error only if order is not found and we've tried to fetch
  if (!currentOrder && notFound) {
    return (
      <View style={[styles.container, { backgroundColor: colors.pageBackground }]}>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.pageBackground }]}>
          <View style={styles.errorContainer}>
            <AppIcon name="alert-circle-outline" size={64} color={colors.primary} />
            <Text style={[styles.errorText, { color: colors.text }]}>Order not found</Text>
            <TouchableOpacity
              style={[styles.errorButton, { backgroundColor: colors.primary }]}
              onPress={handleBackPress}
            >
              <Text style={[styles.errorButtonText, { color: colors.background }]}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!currentOrder && !notFound && resolvedOrderId && !initialOrderHydrated) {
    return (
      <View style={[styles.container, { backgroundColor: colors.pageBackground }]}>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.pageBackground }]}>
          <PageLoader compact message="Loading order..." />
        </SafeAreaView>
      </View>
    );
  }

  if (!currentOrder) {
    return null;
  }

  const placedAt = currentOrder?.created_at ? new Date(currentOrder.created_at) : null;
  const placedAtDisplay = placedAt ? placedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';
  const placedDateDisplay = placedAt
    ? placedAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '--';
  const placedDateShortDisplay = placedAt
    ? placedAt.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
      })
    : '--';
  const canteenName = currentOrder?.canteens?.name || 'HungerTap, Hyderabad';

  // Order status timeline - strictly driven by current status
  const getOrderTimeline = (status) => {
    const placedTime = formatStepTime(stepTimestamps.placed || currentOrder?.created_at);
    const preparingTime = formatStepTime(stepTimestamps.preparing);
    const partiallyReadyTime = formatStepTime(stepTimestamps.partially_ready);
    const readyTime = formatStepTime(stepTimestamps.ready);
    const deliveredTime = formatStepTime(
      stepTimestamps.delivered || currentOrder?.delivered_at
    );
    const cancelledTime = formatStepTime(
      stepTimestamps.cancelled || currentOrder?.updated_at
    );

    const currentStepLocal = getOrderTimelineStep(status);
    const partial = isPartiallyReady(status);

    // Cancelled: Order Placed → Cancelled (red cross)
    if (isCancelledLike(status)) {
      return [
        {
          id: 1,
          title: 'Order Placed',
          description: 'Your order has been received.',
          time: placedTime,
          completed: true,
          failed: false,
          color: colors.success,
        },
        {
          id: 2,
          title:
            status === 'payment_cancelled' ? 'Payment Cancelled' : 'Cancelled by Vendor',
          description:
            status === 'payment_cancelled'
              ? 'Payment was cancelled for this order.'
              : 'Your order has been cancelled by the vendor.',
          time: cancelledTime,
          completed: true,
          failed: true,
          color: colors.error,
        },
      ];
    }

    if (isPaymentFailedLike(status)) {
      return [
        {
          id: 1,
          title: 'Order Placed',
          description: 'Your order was created but payment did not complete.',
          time: placedTime,
          completed: true,
          failed: false,
          color: colors.success,
        },
        {
          id: 2,
          title: 'Payment Failed',
          description:
            'Payment was not completed. If any amount was debited, it will be refunded within a few working days.',
          time: cancelledTime,
          completed: true,
          failed: true,
          color: colors.error,
        },
      ];
    }

    if (status === 'pending_payment') {
      return [
        {
          id: 1,
          title: 'Order created',
          description: 'Your order is saved. Complete payment to send it to the kitchen.',
          time: placedTime,
          completed: true,
          failed: false,
          color: colors.success,
        },
        {
          id: 2,
          title: 'Awaiting payment',
          description: 'Complete payment during checkout to send your order to the kitchen.',
          time: '--',
          completed: false,
          failed: false,
          color: colors.warning,
        },
      ];
    }

    // Ready order not collected before canteen close
    if (isPickupFailed(status)) {
      const pickupFailedTime = formatStepTime(
        stepTimestamps.pickup_failed || currentOrder?.updated_at
      );
      return [
        {
          id: 1,
          title: 'Order Placed',
          description: 'Your order has been received.',
          time: placedTime,
          completed: true,
          failed: false,
          color: colors.success,
        },
        {
          id: 2,
          title: 'Preparing',
          description: 'Your order is preparing in canteen',
          time: preparingTime,
          completed: true,
          failed: false,
          color: colors.success,
        },
        {
          id: 3,
          title: 'Ready for Pickup',
          description: 'Your order was ready at the counter',
          time: readyTime !== '--' ? readyTime : pickupFailedTime,
          completed: true,
          failed: false,
          color: colors.success,
        },
        {
          id: 4,
          title: 'Not Picked Up',
          description: 'Not picked up before the canteen closed. No automatic refund.',
          time: pickupFailedTime,
          completed: true,
          failed: true,
          color: colors.error,
        },
      ];
    }

    // Full progress: Preparing → (Partially Ready in-progress) → Ready → Delivered
    return [
      {
        id: 1,
        title: 'Order Placed',
        description: 'Your order has been received.',
        time: placedTime,
        completed: true,
        failed: false,
        color: colors.success,
      },
      {
        id: 2,
        title: 'Preparing',
        description: 'Your order is preparing in canteen',
        time: currentStepLocal >= 2 ? preparingTime : '--',
        completed: currentStepLocal >= 2,
        failed: false,
        color: currentStepLocal >= 2 ? colors.success : colors.textTertiary,
      },
      {
        id: 3,
        title: partial ? 'Partially Ready' : 'Ready for Pickup',
        description: partial
          ? 'Some items in your order are ready'
          : 'Your order is ready for pickup at counter',
        time: partial
          ? partiallyReadyTime
          : currentStepLocal >= 3
            ? readyTime
            : '--',
        // Fully ready completes this step; partially_ready stays between preparing & ready.
        completed: currentStepLocal >= 3,
        active: partial,
        failed: false,
        color: currentStepLocal >= 3
          ? colors.success
          : partial
            ? colors.brandYellow || '#F5BC3B'
            : colors.textTertiary,
      },
      {
        id: 4,
        title: 'Delivered',
        description: 'Your order has been Delivered Successfully.',
        time: currentStepLocal >= 4 ? deliveredTime : '--',
        completed: currentStepLocal >= 4,
        failed: false,
        color: currentStepLocal >= 4 ? colors.success : colors.textTertiary,
      },
    ];
  };


  const getStatusColor = (status) => getOrderStatusColor(status, colors);
  const getStatusText = (status) =>
    status === 'ready' ? 'Ready for pickup' : getOrderStatusLabel(status);

  const orderIsActiveKitchen = isActiveKitchenStatus(currentOrder?.status);

  // QR when ready or partially_ready; hidden 30 min after delivered
  const isQRExpired = () => {
    if (currentOrder.status !== 'delivered' || !currentOrder.delivered_at) {
      return false;
    }
    
    const deliveredTime = new Date(currentOrder.delivered_at);
    const currentTime = new Date();
    const timeDifference = currentTime - deliveredTime;
    const thirtyMinutes = 30 * 60 * 1000;
    
    return timeDifference > thirtyMinutes;
  };

  const timeline = getOrderTimeline(currentOrder.status);
  const currentStep = getOrderTimelineStep(currentOrder.status);
  const qrPayloadValue = String(
    currentOrder?.barcode ||
      encryptedQRCode ||
      currentOrder?.order_token ||
      currentOrder?.id ||
      'order'
  );

  const orderIsDelivered = isDeliveredLike(currentOrder.status);
  const orderIsPaymentFailed = isPaymentFailedLike(currentOrder.status);
  const orderIsPickupFailed = isPickupFailed(currentOrder.status);
  const isReorderEligible = isReorderEligibleStatus(currentOrder.status);
  const persistedTotal = persistedTotalForLock;

  /**
   * Prefer locked/DB `total_amount` over line-item sums. Delivered+takeaway used to
   * prefer food-only computed totals, which oscillated with realtime/refetch.
   */
  const finalTotal = (() => {
    if (
      orderIsDelivered &&
      deliveredTotalLockRef.current != null &&
      deliveredTotalLockRef.current > 0
    ) {
      return deliveredTotalLockRef.current;
    }
    if (persistedTotal !== null && Number.isFinite(persistedTotal) && persistedTotal > 0) {
      return persistedTotal;
    }
    return computedTotal;
  })();

  const pricedLinesSum = orderItems.reduce((sum, item) => {
    const t = resolveItemTotal(item);
    return sum + (t !== null ? t : 0);
  }, 0);

  const billLineItems =
    orderIsDelivered &&
    finalTotal > 0 &&
    orderItems.length > 0 &&
    pricedLinesSum < 0.01
      ? allocateLineTotalsFromGrandTotal(orderItems, finalTotal)
      : orderItems;

  const totalAmountDisplay = formatCurrencyValue(finalTotal);

  const isTakeawayOrder =
    currentOrder?.is_takeaway === true || currentOrder?.order_type === true;

  /** Prefer DB columns; else match cart rule (₹10 × total item qty) when takeaway is set. */
  let takeawayChargeDisplay = null;
  if (isTakeawayOrder) {
    const explicit = parseCurrencyValue(
      currentOrder?.takeaway_charge ??
        currentOrder?.takeaway_fee ??
        currentOrder?.take_away_charge
    );
    if (explicit !== null && Number.isFinite(explicit) && explicit >= 0) {
      takeawayChargeDisplay = explicit;
    } else {
      const rows = pickLineRowsFromOrderRow(currentOrder);
      const targetLines = rows.length > 0 ? rows : (Array.isArray(orderItems) ? orderItems : []);
      takeawayChargeDisplay = takeawayChargeForLines(targetLines, true);
    }
  }

  const takeawayChargesRow =
    isTakeawayOrder && takeawayChargeDisplay !== null ? (
      <View style={[styles.takeawayChargeRow, { borderTopColor: colors.divider }]}>
        <Text style={[styles.takeawayChargeLabel, { color: colors.textSecondary }]}>
          Takeaway charges
        </Text>
        <Text style={[styles.takeawayChargeValue, { color: colors.text }]}>
          ₹{formatCurrencyValue(takeawayChargeDisplay)}
        </Text>
      </View>
    ) : null;

  const isPendingPayment = currentOrder.status === 'pending_payment';
  const pendingStripBg = isDarkMode ? 'rgba(245, 158, 11, 0.22)' : '#FFF8E6';
  const failedStripBg = isDarkMode ? 'rgba(239, 68, 68, 0.2)' : '#FFEBEB';

  const cardOutline = isDarkMode ? { borderWidth: 1, borderColor: colors.border } : {};
  const successStripBg = isDarkMode ? 'rgba(16, 185, 129, 0.18)' : '#E5FFE9';
  const waveDecorationFill = isDarkMode ? 'rgba(96, 165, 250, 0.2)' : '#E2F2FF';

  // Timeline ready for display

  return (
    <View style={[styles.container, { backgroundColor: colors.pageBackground }]}>
      <BrandYellowStrip />
      
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.elevatedSurface }]}>
        <TouchableOpacity onPress={handleBackPress} style={styles.backButton}>
          <AppIcon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Order Status</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.headerRefreshButton} disabled={refreshing}>
          {refreshing ? (
            <LoadingSpinner size="small" color={colors.primary} />
          ) : (
            <AppIcon name="refresh" size={20} color={colors.text} />
          )}
        </TouchableOpacity>
      </View>
      
      {/* Separator Line */}
      <View style={[styles.separator, { backgroundColor: colors.border }]} />

      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.pageBackground }]}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'never' : 'automatic'}
        automaticallyAdjustContentInsets={false}
        refreshControl={
          <RefreshControl
            {...pullRefreshControlProps({
              refreshing,
              onRefresh,
              tintColor: colors.primary,
              progressOffset: 0,
              androidBackgroundColor: colors.elevatedSurface,
            })}
          />
        }
      >
        {/* Order Summary Card */}
        <View style={[styles.orderSummaryCard, { backgroundColor: colors.elevatedSurface }, cardOutline]}>
          <Text style={[styles.orderNumber, { color: colors.text }]}>Order #{currentOrder?.order_token || currentOrder?.orderNumber || '2435'}</Text>
          
          <View style={styles.locationRow}>
            <AppIcon name="location" size={12} color={colors.error} />
            <Text style={[styles.locationText, { color: colors.textSecondary }]}>{canteenName}</Text>
          </View>
          
          {isPendingPayment ? (
            <View style={[styles.successStrip, { backgroundColor: pendingStripBg }]}>
              <View style={[styles.successContent, { flexWrap: 'wrap' }]}>
                <AppIcon name="wallet-outline" size={20} color={colors.warning} style={{ marginTop: 2 }} />
                <View style={[styles.successTextContainer, { flex: 1, minWidth: 0 }]}>
                  <Text style={[styles.successTitle, { color: colors.text }]}>Payment required</Text>
                  <Text style={[styles.successInfoLine, { color: colors.textSecondary }]}>
                    This order was not paid. Place a new order from the menu if you still want these items.
                  </Text>
                </View>
              </View>
            </View>
          ) : orderIsPaymentFailed ? (
            <View style={[styles.successStrip, { backgroundColor: failedStripBg }]}>
              <View style={[styles.successContent, { flexWrap: 'wrap' }]}>
                <AppIcon name="close-circle" size={20} color={colors.error} style={{ marginTop: 2 }} />
                <View style={[styles.successTextContainer, { flex: 1, minWidth: 0 }]}>
                  <Text style={[styles.successTitle, { color: colors.text }]}>Payment failed</Text>
                  <Text style={[styles.successInfoLine, { color: colors.textSecondary }]}>
                    Payment did not complete, so this order was not confirmed. You can place a new order from the menu anytime.
                  </Text>
                  <Text style={[styles.paymentFailedRefundNote, { color: colors.textSecondary }]}>
                    If money was debited from your account, it will be refunded to your original payment method within a few
                    working days (usually 5–7 business days). For further support,{' '}
                    <Text
                      style={[styles.paymentFailedContactLink, { color: colors.warning }]}
                      onPress={handlePaymentSupportContact}
                      suppressHighlighting
                    >
                      contact us
                    </Text>
                    .
                  </Text>
                </View>
              </View>
            </View>
          ) : orderIsPickupFailed ? (
            <View style={[styles.successStrip, { backgroundColor: failedStripBg }]}>
              <View style={[styles.successContent, { flexWrap: 'wrap' }]}>
                <AppIcon name="close-circle" size={20} color={colors.error} style={{ marginTop: 2 }} />
                <View style={[styles.successTextContainer, { flex: 1, minWidth: 0 }]}>
                  <Text style={[styles.successTitle, { color: colors.text }]}>Not picked up</Text>
                  <Text style={[styles.successInfoLine, { color: colors.textSecondary }]}>
                    Your order was not picked up before the canteen closed. There is no automatic refund for uncollected ready
                    items.
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={[styles.successStrip, { backgroundColor: successStripBg }]}>
              <View style={styles.successContent}>
                <AppIcon name="checkmark-circle" size={18} color={colors.success} style={{ marginTop: 2 }} />
                <View style={styles.successTextContainer}>
                  <Text style={[styles.successTitle, { color: colors.text }]}>Order Successful</Text>
                  <Text style={[styles.successInfoLine, { color: colors.textSecondary }]}>
                    on {currentOrder?.created_at ? new Date(currentOrder.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Jan 15, 2025'} at {currentOrder?.created_at ? new Date(currentOrder.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '2:30 PM'} by {profileFullName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Total Bill Card */}
        <View style={[styles.totalBillCard, { backgroundColor: colors.elevatedSurface }, cardOutline]}>
          <TouchableOpacity 
            style={styles.totalBillHeader}
            onPress={() => setIsOrderSummaryExpanded(!isOrderSummaryExpanded)}
          >
          <View style={styles.billHeaderMainRow}>
            <View style={styles.billHeaderLeft}>
              <AppIcon name="receipt" size={26} color={colors.text} />
              <Text style={[styles.billTitle, { color: colors.text }]}>Total Bill</Text>
            </View>
            <View style={styles.billHeaderRight}>
              <Text style={[styles.billAmount, { color: colors.accentGreen }]}>₹{totalAmountDisplay}</Text>
              <AppIcon
                name={isOrderSummaryExpanded ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={colors.textTertiary || '#8E8E93'}
                style={styles.billChevron}
              />
            </View>
          </View>
          </TouchableOpacity>

          {/* Price Breakdown */}
          {isOrderSummaryExpanded && (
            <View style={[styles.priceBreakdownSection, { borderTopColor: colors.border }]}>
              {billLineItems && billLineItems.length > 0 ? (
                <>
                  {/* Table Header */}
                  <View style={styles.tableHeaderRow}>
                    <View style={styles.tableColumnItem}>
                      <Text style={[styles.tableHeaderText, { color: colors.textTertiary }]}>Item</Text>
                    </View>
                    <View style={styles.tableColumnQty}>
                      <Text style={[styles.tableHeaderTextCentered, { color: colors.textTertiary }]}>Qty</Text>
                    </View>
                    <View style={styles.tableColumnPrice}>
                      <Text style={[styles.tableHeaderTextCentered, { color: colors.textTertiary }]}>Price</Text>
                    </View>
                    <View style={styles.tableColumnStatus}>
                      <Text style={[styles.tableHeaderTextRight, { color: colors.textTertiary }]}>Status</Text>
                    </View>
                  </View>
                  <View style={[styles.tableDivider, { backgroundColor: colors.divider }]} />
                  {/* Table Rows */}
                  {billLineItems.map((item, index) => {
                    const name = item.name || 'Item';
                    const qty = item.quantity || 1;
                    const itemTotal = resolveItemTotal(item);
                    const priceStr = itemTotal !== null
                      ? `₹${formatCurrencyValue(itemTotal)}`
                      : '₹—';
                    const lineStatus =
                      orderIsActiveKitchen && item?.status
                        ? item.status
                        : item?.status || currentOrder?.status;
                    const statusLabel = getStatusText(lineStatus) || '—';

                    return (
                      <View key={index} style={styles.tableRow}>
                        <View style={styles.tableColumnItem}>
                          <Text
                            style={[styles.tableCellItem, { color: colors.text }]}
                            textBreakStrategy="highQuality"
                            android_hyphenationFrequency="none"
                          >
                            {name}
                          </Text>
                        </View>
                        <View style={styles.tableColumnQty}>
                          <Text style={[styles.tableCellQty, { color: colors.text }]}>{qty}</Text>
                        </View>
                        <View style={styles.tableColumnPrice}>
                          <Text style={[styles.tableCellPrice, { color: colors.accentGreen }]}>{priceStr}</Text>
                        </View>
                        <View style={styles.tableColumnStatus}>
                          <Text
                            style={[styles.tableCellStatus, { color: getStatusColor(lineStatus) }]}
                            numberOfLines={2}
                          >
                            {statusLabel}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                  {takeawayChargesRow}
                  <View style={[styles.priceBreakdownTotal, { borderTopColor: colors.divider }]}>
                    <Text style={[styles.priceBreakdownTotalLabel, { color: colors.text }]}>Total</Text>
                    <Text style={[styles.priceBreakdownTotalAmount, { color: colors.accentGreen }]}>₹{totalAmountDisplay}</Text>
                  </View>
                </>
              ) : finalTotal > 0 ? (
                <View style={styles.priceBreakdownItem}>
                  <Text style={[styles.priceBreakdownItemName, { color: colors.textSecondary }]}>
                    Line items unavailable — archived total
                  </Text>
                  <Text style={[styles.priceBreakdownItemPrice, { color: colors.accentGreen }]}>
                    ₹{totalAmountDisplay}
                  </Text>
                </View>
              ) : (
                <View style={styles.priceBreakdownItem}>
                  <Text style={[styles.priceBreakdownItemName, { color: colors.textSecondary }]}>No items found</Text>
                  <Text style={[styles.priceBreakdownItemPrice, { color: colors.accentGreen }]}>₹0.00</Text>
                </View>
              )}
              
              {/* Wave SVG Decoration - only when expanded */}
              <View style={styles.waveContainer}>
                <Svg width="100%" height="55" viewBox="0 0 360 55" fill="none">
                  <Path 
                    d="M0 55V12.7607C74.5829 73.3865 48.9397 25.0184 52.2675 12.7607C52.2675 12.7607 63.4258 31.1472 85.155 31.1472C106.884 31.1472 112.679 12.7607 133.312 12.7607C153.944 12.7607 160.848 30.5569 181.468 31.1472C203.773 31.7858 218.465 -24.5092 234.323 12.7607C250.181 50.0307 314.191 2.32516 302.447 31.1472C290.703 59.9693 360 12.7607 360 12.7607V55H0Z" 
                    fill={waveDecorationFill}
                  />
                </Svg>
              </View>
            </View>
          )}
        </View>

        {/* Order Tracking Timeline */}
        <View style={[styles.timelineCard, { backgroundColor: colors.elevatedSurface }, cardOutline]}>
          {timeline.map((step, index) => (
            <React.Fragment key={step.id}>
            <View style={styles.timelineItem}>
              <View style={styles.timelineLeft}>
                {(() => {
                  const accent = step.failed
                    ? colors.error
                    : step.completed
                      ? colors.success
                      : step.active
                        ? colors.brandYellow || '#F5BC3B'
                        : colors.textTertiary;
                  const ring = step.failed
                    ? isDarkMode
                      ? 'rgba(239, 68, 68, 0.28)'
                      : '#FFD6D6'
                    : step.completed
                      ? isDarkMode
                        ? 'rgba(16, 185, 129, 0.28)'
                        : '#D4FFDA'
                      : step.active
                        ? isDarkMode
                          ? 'rgba(245, 188, 59, 0.28)'
                          : '#FFF3D1'
                        : isDarkMode
                          ? 'rgba(255, 255, 255, 0.12)'
                          : '#E8E8E8';
                  return (
                    <View style={[styles.timelineOuter, { backgroundColor: ring }]}>
                      <View style={[styles.timelineMiddle, { backgroundColor: accent }]}>
                        <View
                          style={[
                            styles.timelineInner,
                            { backgroundColor: isDarkMode ? colors.elevatedSurface : '#FFFFFF' },
                          ]}
                        >
                          {step.failed ? (
                            <AppIcon name="close" size={11} color={accent} />
                          ) : step.completed ? (
                            <AppIcon name="checkmark" size={11} color={accent} />
                          ) : (
                            <View style={[styles.timelinePendingCore, { backgroundColor: accent }]} />
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })()}
                {index < timeline.length - 1 && (
                  <View
                    style={[
                      styles.timelineLine,
                      {
                        backgroundColor: step.failed
                          ? colors.error
                          : step.completed
                            ? colors.success
                            : colors.textTertiary,
                      },
                    ]}
                  />
                )}
              </View>
              
              <View style={styles.timelineContent}>
                <Text style={[styles.timelineTitle, { color: step.color || colors.text }]}>{step.title}</Text>
                <Text style={[styles.timelineDescription, { color: colors.textSecondary }]}>{step.description}</Text>
              </View>
              
              <Text style={[styles.timelineTime, { color: colors.textTertiary }]}>{step.time}</Text>
            </View>
            {step.id === 3 && canShowPickupQr(currentOrder?.status) && !isQRExpired() && (
              <View style={styles.qrCodeSection}>
                <View style={[styles.qrCodeCard, { backgroundColor: colors.elevatedSurface }, cardOutline]}>
                  <Text style={[styles.qrCodeTitle, { color: colors.text }]}>Show this QR code at the counter</Text>
                  <Text style={[styles.qrCodeSubtitle, { color: colors.textSecondary }]}>Order #{currentOrder?.order_token || currentOrder?.id}</Text>
                  <View style={[styles.qrCodeContainer, { backgroundColor: '#FFFFFF' }]}>
                    {qrLoading ? (
                      <LoadingSpinner size="large" color={colors.primary} />
                    ) : (
                      <QRCode
                        value={qrPayloadValue}
                        size={170}
                        color="#000000"
                        backgroundColor="#FFFFFF"
                      />
                    )}
                  </View>
                  <Text style={[styles.qrCodeNote, { color: colors.textTertiary }]}>
                    {encryptedQRCode ? '🔐 Secure encrypted QR code' : 'Present this code at pickup'}
                  </Text>
                </View>
              </View>
            )}
            </React.Fragment>
          ))}

          {/* QR injected after Ready step above; removed duplicate section */}
          
        </View>
        {isReorderEligible ? (
          <TouchableOpacity
            style={[styles.reorderOptionButton, { backgroundColor: colors.brandOrange }]}
            onPress={handleReorderFromOrder}
            disabled={reordering}
          >
            {reordering ? (
              <LoadingSpinner size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
            ) : (
              <AppIcon name="refresh" size={16} color="#FFFFFF" />
            )}
            <Text style={styles.reorderOptionButtonText}>
              {reordering ? 'Reordering...' : 'Reorder Items'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  errorButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  errorButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  topYellowStrip: {
    width: screenWidth,
    height: 34,
    backgroundColor: '#f5bc3b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: 'white',
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: appTypography.bold,
    color: '#4D4D4D',
    textAlign: 'center',
    flex: 1,
  },
  headerSpacer: {
    width: 32,
  },
  headerRefreshButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: {
    width: screenWidth,
    height: 1,
    backgroundColor: '#E3E3E3',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
    alignItems: 'center',
    paddingHorizontal: 0,
  },
  orderSummaryCard: {
    width: '92%',
    backgroundColor: 'white',
    borderRadius: 12,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 0,
    alignSelf: 'center',
  },
  orderNumber: {
    fontSize: 24,
    fontFamily: appTypography.bold,
    color: 'black',
    marginBottom: 8,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  locationText: {
    fontSize: 10,
    fontFamily: appTypography.semiBold,
    color: '#8D8D8D',
    marginLeft: 4,
  },
  reorderOptionButton: {
    width: '92%',
    alignSelf: 'center',
    marginTop: -8,
    marginBottom: 28,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  reorderOptionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  successStrip: {
    width: 'calc(100% + 40px)',
    backgroundColor: '#E5FFE9',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    marginHorizontal: -20,
    marginTop: 0,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  successContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  successTextContainer: {
    marginLeft: 8,
    flex: 1,
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 13,
    fontFamily: appTypography.bold,
    color: '#4D4D4D',
    lineHeight: 18,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  successInfoLine: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555555',
    marginTop: 2,
  },
  paymentFailedRefundNote: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 8,
  },
  paymentFailedContactLink: {
    fontFamily: appTypography.semiBold,
    textDecorationLine: 'underline',
  },
  totalBillCard: {
    width: '92%',
    backgroundColor: 'white',
    borderRadius: 12,
    marginTop: 16,
    marginBottom: 20,
    overflow: 'hidden',
    position: 'relative',
    alignSelf: 'center',
  },
  waveContainer: {
    width: 'calc(100% + 40px)',
    height: 55,
    marginTop: 0,
    marginHorizontal: -20,
    marginBottom: -12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalBillHeader: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    minHeight: 75,
  },
  billHeaderMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  billHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  billHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  billTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#212121',
    flexShrink: 1,
  },
  billAmount: {
    fontSize: 20,
    fontWeight: '700',
    color: '#00B330',
  },
  billChevron: {
    marginLeft: 2,
  },
  timelineCard: {
    width: '92%',
    backgroundColor: 'white',
    borderRadius: 12,
    marginTop: 16,
    marginBottom: 32,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    alignSelf: 'center',
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  timelineLeft: {
    alignItems: 'center',
    marginRight: 20,
  },
  timelineOuter: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineMiddle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineInner: {
    width: 14,
    height: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelinePendingCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  timelineCircle: {
    width: 49,
    height: 49,
    borderRadius: 24.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 12,
  },
  timelineLine: {
    width: 2,
    height: 30,
    marginTop: 6,
  },
  timelineContent: {
    flex: 1,
    marginRight: 20,
  },
  timelineTitle: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    color: '#4D4D4D',
    marginBottom: 8,
  },
  timelineDescription: {
    fontSize: 11,
    fontFamily: appTypography.semiBold,
    color: '#8D8D8D',
    lineHeight: 13,
  },
  timelineTime: {
    fontSize: 10,
    fontFamily: appTypography.semiBold,
    color: '#8D8D8D',
    textAlign: 'right',
  },
  // Price Breakdown Section
  priceBreakdownSection: {
    borderTopWidth: 1,
    borderTopColor: '#E3E3E3',
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 0, // Remove bottom padding to allow wave to extend
    overflow: 'visible',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#646464',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tableHeaderTextCentered: {
    fontSize: 12,
    fontWeight: '700',
    color: '#646464',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  tableHeaderTextRight: {
    fontSize: 12,
    fontWeight: '700',
    color: '#646464',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'right',
  },
  tableColumnItem: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
    flexShrink: 1,
  },
  tableColumnQty: { width: 36, alignItems: 'center', flexShrink: 0 },
  tableColumnPrice: { width: 70, alignItems: 'center', flexShrink: 0 },
  tableColumnStatus: {
    width: 72,
    flexShrink: 0,
    alignItems: 'flex-end',
    paddingLeft: 4,
  },
  tableDivider: {
    height: 1,
    backgroundColor: '#E3E3E3',
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  tableCellItem: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
    width: '100%',
    flexShrink: 1,
  },
  tableCellQty: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333333',
    textAlign: 'center',
  },
  tableCellPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#00B330',
    textAlign: 'center',
    width: '100%',
  },
  tableCellStatus: {
    fontSize: 11,
    fontWeight: '600',
    color: '#000000',
    textAlign: 'right',
    lineHeight: 15,
    width: '100%',
  },
  priceBreakdownItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  priceBreakdownItemImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#F0F0F0',
  },
  priceBreakdownItemDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  priceBreakdownItemName: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontFamily: appTypography.semiBold,
    color: '#646464',
  },
  priceBreakdownItemPrice: {
    fontSize: 16,
    fontFamily: appTypography.bold,
    color: '#00B330',
    flexShrink: 0,
    marginLeft: 8,
  },
  takeawayChargeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E3E3E3',
  },
  takeawayChargeLabel: {
    fontSize: 15,
    fontFamily: appTypography.semiBold,
  },
  takeawayChargeValue: {
    fontSize: 15,
    fontFamily: appTypography.bold,
  },
  priceBreakdownTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E3E3E3',
    paddingTop: 12,
    marginTop: 8,
  },
  priceBreakdownTotalLabel: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    color: '#4D4D4D',
  },
  priceBreakdownTotalAmount: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    color: '#00B330',
  },
  
  // QR Code Styles
  qrCodeSection: {
    marginTop: 0,
    marginBottom: 28,
    paddingHorizontal: 20,
  },
  inlineQRWrapper: {
    flex: 1,
    marginTop: 0,
    marginLeft: 0,
    marginRight: 0,
  },
  qrCodeCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  qrCodeTitle: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  qrCodeSubtitle: {
    fontSize: 14,
    fontFamily: appTypography.regular,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  qrCodeContainer: {
    backgroundColor: 'white',
    padding: 24,
    borderRadius: 8,
    marginBottom: 16,
  },
  qrCodeNote: {
    fontSize: 12,
    fontFamily: appTypography.regular,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});

export default OrderStatusScreen; 