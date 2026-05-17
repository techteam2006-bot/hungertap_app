import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  SafeAreaView,
  RefreshControl,
  Dimensions,
  Alert,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const SUPPORT_EMAIL = 'support@hungertap.online';

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
          'Email app not available',
          `Install an email app or write to ${SUPPORT_EMAIL} from your browser.`,
          [{ text: 'OK' }]
        );
      }
    } catch {
      Alert.alert('Error', 'Unable to open your email app. Please try again.');
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
        console.error('Error fetching order status:', error);
        setNotFound(true);
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

        const isDeliveredLike =
          data.status === 'delivered' || data.status === 'completed';

        const snapshotName =
          data.item_name != null && String(data.item_name).trim() !== ''
            ? String(data.item_name).trim()
            : null;
        let item_name = snapshotName || itemSummaryFromRows || null;
        let total_amount = resolveOrderHeaderTotalFromRows(data, orderItemsRows);

        const needsArchiveSnapshot =
          isDeliveredLike &&
          (!item_name || !(Number.isFinite(total_amount) && total_amount > 0));
        if (needsArchiveSnapshot) {
          try {
            const { data: arc, error: arcErr } = await supabase
              .from('archived_orders')
              .select('total_amount, item_name')
              .eq('order_id', data.id)
              .maybeSingle();
            if (!arcErr && arc) {
              const at = arc.total_amount != null ? Number(arc.total_amount) : NaN;
              if (Number.isFinite(at) && at > 0 && total_amount < 0.01) {
                total_amount = Number(at.toFixed(2));
              }
              if (arc.item_name != null && String(arc.item_name).trim() !== '') {
                item_name = String(arc.item_name).trim();
              }
            }
          } catch (_) {
            /* archived_orders table may not exist */
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
        // No data and no error indicates not found
        setNotFound(true);
      }
    } catch (error) {
      console.error('Error fetching order status:', error);
      setNotFound(true);
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

  // Fetch order status on mount and set up real-time subscription (NO POLLING)
  useEffect(() => {
    // Force immediate fetch on mount (full data)
    fetchLatestOrderStatus();

    // Set up real-time subscription for order status updates (REALTIME ONLY)
    const subscription = supabase
      .channel(`order_status_${resolvedOrderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${resolvedOrderId}`
        },
        (payload) => {
          if (payload.new) {
            fetchLatestOrderStatus();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${resolvedOrderId}`
        },
        (payload) => {
          console.log('New order created:', payload.new);
          if (payload.new) {
            fetchLatestOrderStatus();
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [resolvedOrderId, user?.id]);

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
            <Ionicons name="alert-circle-outline" size={64} color={colors.primary} />
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
    const now = new Date();
    const placedTime = currentOrder?.created_at ? new Date(currentOrder.created_at) : now;

    // Determine current step from status (pending removed, preparing is first step)
    const stepFromStatus = (s) => {
      switch (s) {
        case 'pending_payment':
          return 1;
        case 'preparing':
          return 2; // Order placed + preparing should both be completed
        case 'ready':
          return 3;
        case 'delivered':
        case 'completed':
        case 'paid':
          return 4;
        case 'payment_failed':
        case 'failed':
        case 'cancelled':
          return 0; // terminal — not delivered progress
        default:
          return 2; // Default to preparing progress
      }
    };

    const currentStepLocal = stepFromStatus(status);


    let timeline = [];
    
    // For cancelled orders, show only Order Placed and Order Cancelled
    if (status === 'cancelled') {
      timeline = [
        {
          id: 1,
          title: 'Order Placed',
          description: 'Your order has been received.',
          time: placedAtDisplay,
          completed: true,
          icon: 'time',
          color: colors.success
        },
        {
          id: 2,
          title: 'Order Cancelled',
          description: 'Your order has been cancelled.',
          time: (currentOrder?.updated_at ? new Date(currentOrder.updated_at) : now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          completed: true,
          icon: 'close-circle',
          color: colors.error
        }
      ];
    } else if (status === 'payment_failed' || status === 'failed') {
      timeline = [
        {
          id: 1,
          title: 'Order Placed',
          description: 'Your order was created but payment did not complete.',
          time: placedAtDisplay,
          completed: true,
          icon: 'time',
          color: colors.success,
        },
        {
          id: 2,
          title: 'Payment Failed',
          description:
            'Payment was not completed. If any amount was debited, it will be refunded within a few working days.',
          time: (currentOrder?.updated_at ? new Date(currentOrder.updated_at) : now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          completed: true,
          icon: 'close-circle',
          color: colors.error,
        },
      ];
    } else if (status === 'pending_payment') {
      timeline = [
        {
          id: 1,
          title: 'Order created',
          description: 'Your order is saved. Complete payment to send it to the kitchen.',
          time: placedAtDisplay,
          completed: true,
          icon: 'time',
          color: colors.success,
        },
        {
          id: 2,
          title: 'Awaiting payment',
          description: 'Complete payment during checkout to send your order to the kitchen.',
          time: '--',
          completed: false,
          icon: 'wallet-outline',
          color: colors.warning,
        },
      ];
    // For delivered orders, show only Order Placed and Delivered
    } else if (status === 'delivered' || status === 'completed') {
      timeline = [
        {
          id: 1,
          title: 'Order Placed',
          description: 'Your order has been received.',
          time: placedAtDisplay,
          completed: true,
          icon: 'time',
          color: colors.success
        },
        {
          id: 2,
          title: 'Delivered',
          description: 'Your order has been Delivered Successfully.',
          time: currentOrder?.delivered_at ? new Date(currentOrder.delivered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--',
          completed: true,
          icon: 'time',
          color: colors.success
        }
      ];
    } else {
      // For other statuses, show full timeline
      timeline = [
        {
          id: 1,
          title: 'Order Placed',
          description: 'Your order has been received.',
          time: placedAtDisplay,
          completed: true,
          icon: 'time',
          color: colors.success
        },
        {
          id: 2,
          title: 'Preparing',
          description: 'Your order is preparing in canteen',
          time: '--',
          completed: currentStepLocal >= 2,
          icon: 'time',
          color: currentStepLocal >= 2 ? colors.success : colors.textTertiary
        },
        {
          id: 3,
          title: 'Ready for Pickup',
          description: 'Your order is ready for pickup at counter',
          time: '--',
          completed: currentStepLocal >= 3,
          icon: 'time',
          color: currentStepLocal >= 3 ? colors.success : colors.textTertiary
        },
        {
          id: 4,
          title: 'Delivered',
          description: 'Your order has been Delivered Successfully.',
          time: '--',
          completed: currentStepLocal >= 4,
          icon: 'time',
          color: currentStepLocal >= 4 ? colors.success : colors.textTertiary
        }
      ];
    }
    
    // Handle special statuses
    if (status === 'payment_cancelled') {
      timeline.push({
        id: 5,
        title: 'Payment Cancelled',
        description: 'Payment was cancelled',
        time: (currentOrder?.updated_at ? new Date(currentOrder.updated_at) : now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        completed: true,
        icon: 'close-circle',
        color: colors.error
      });
    }
    
    return timeline;
  };


  const getStatusColor = (status) => {
    switch (status) {
      case 'pending_payment':
        return colors.info;
      case 'preparing':
        return colors.warning; // Orange (first step, pending removed)
      case 'ready':
        return colors.success; // Green
      case 'on_way':
        return colors.info; // Blue
      case 'delivered':
        return colors.success; // Green
      case 'paid':
        return colors.success; // Green
      case 'payment_cancelled':
        return colors.error; // Red
      case 'payment_failed':
      case 'failed':
        return colors.error; // Red
      case 'cancelled':
        return colors.error; // Red
      default:
        return colors.warning; // Default to preparing color
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'pending_payment':
        return 'Awaiting payment';
      case 'preparing':
        return 'Preparing'; // First step (pending removed)
      case 'ready':
        return 'Ready for Pickup';
      case 'on_way':
        return 'On the Way';
      case 'delivered':
        return 'Delivered';
      case 'paid':
        return 'Payment Successful';
      case 'payment_cancelled':
        return 'Payment Cancelled';
      case 'payment_failed':
      case 'failed':
        return 'Payment Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status || 'Preparing'; // Default to preparing
    }
  };

  // Check if QR code should be expired (30 minutes after delivery)
  // QR codes are only shown when status is 'ready' and are automatically removed
  // 30 minutes after the order is marked as 'delivered'
  const isQRExpired = () => {
    if (currentOrder.status !== 'delivered' || !currentOrder.delivered_at) {
      return false;
    }
    
    const deliveredTime = new Date(currentOrder.delivered_at);
    const currentTime = new Date();
    const timeDifference = currentTime - deliveredTime;
    const thirtyMinutes = 30 * 60 * 1000; // 30 minutes in milliseconds
    
    return timeDifference > thirtyMinutes;
  };

  const timeline = getOrderTimeline(currentOrder.status);
  
  // Get current step for better debugging (pending removed, preparing is first step)
  const getCurrentStep = (status) => {
    switch (status) {
      case 'pending_payment':
        return 1;
      case 'preparing':
        return 2; // Order placed + preparing completed
      case 'ready':
        return 3;
      case 'delivered':
      case 'completed':
      case 'paid':
        return 4;
      case 'payment_failed':
      case 'failed':
      case 'cancelled':
        return 0;
      default:
        return 2; // Default to preparing progress
    }
  };
  
  const currentStep = getCurrentStep(currentOrder.status);
  const qrPayloadValue = String(
    currentOrder?.barcode ||
      encryptedQRCode ||
      currentOrder?.order_token ||
      currentOrder?.id ||
      'order'
  );

  const isDeliveredLike =
    currentOrder.status === 'delivered' || currentOrder.status === 'completed';
  const isPaymentFailedLike =
    currentOrder.status === 'payment_failed' || currentOrder.status === 'failed';
  const isCancelledLike =
    currentOrder.status === 'cancelled' || currentOrder.status === 'payment_cancelled';
  const isReorderEligible = isCancelledLike || isPaymentFailedLike || isDeliveredLike;
  const persistedTotal = parseCurrencyValue(currentOrder?.total_amount);

  const finalTotal = (() => {
    if (isDeliveredLike) {
      if (computedTotal > 0.005) {
        return computedTotal;
      }
      if (persistedTotal !== null && Number.isFinite(persistedTotal) && persistedTotal > 0) {
        return persistedTotal;
      }
      return computedTotal;
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
    isDeliveredLike &&
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
      let qty = rows.reduce((s, oi) => s + (Number(oi?.quantity ?? 1) || 1), 0);
      if (qty <= 0 && Array.isArray(orderItems) && orderItems.length > 0) {
        qty = orderItems.reduce((s, i) => s + (Number(i?.quantity ?? 1) || 1), 0);
      }
      if (qty > 0) takeawayChargeDisplay = qty * 10;
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
      {/* Top Yellow Strip */}
      <View style={[styles.topYellowStrip, { backgroundColor: colors.brandYellow }]} />
      
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.elevatedSurface }]}>
        <TouchableOpacity onPress={handleBackPress} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Order Status</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.headerRefreshButton} disabled={refreshing}>
          {refreshing ? (
            <LoadingSpinner size="small" color={colors.primary} />
          ) : (
            <Ionicons name="refresh" size={20} color={colors.text} />
          )}
        </TouchableOpacity>
      </View>
      
      {/* Separator Line */}
      <View style={[styles.separator, { backgroundColor: colors.border }]} />

      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.pageBackground }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Order Summary Card */}
        <View style={[styles.orderSummaryCard, { backgroundColor: colors.elevatedSurface }, cardOutline]}>
          <Text style={[styles.orderNumber, { color: colors.text }]}>Order #{currentOrder?.order_token || currentOrder?.orderNumber || '2435'}</Text>
          
          <View style={styles.locationRow}>
            <Ionicons name="location" size={12} color={colors.error} />
            <Text style={[styles.locationText, { color: colors.textSecondary }]}>{canteenName}</Text>
          </View>
          
          {isPendingPayment ? (
            <View style={[styles.successStrip, { backgroundColor: pendingStripBg }]}>
              <View style={[styles.successContent, { flexWrap: 'wrap' }]}>
                <Ionicons name="wallet-outline" size={20} color={colors.warning} style={{ marginTop: 2 }} />
                <View style={[styles.successTextContainer, { flex: 1, minWidth: 0 }]}>
                  <Text style={[styles.successTitle, { color: colors.text }]}>Payment required</Text>
                  <Text style={[styles.successInfoLine, { color: colors.textSecondary }]}>
                    This order was not paid. Place a new order from the menu if you still want these items.
                  </Text>
                </View>
              </View>
            </View>
          ) : isPaymentFailedLike ? (
            <View style={[styles.successStrip, { backgroundColor: failedStripBg }]}>
              <View style={[styles.successContent, { flexWrap: 'wrap' }]}>
                <Ionicons name="close-circle" size={20} color={colors.error} style={{ marginTop: 2 }} />
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
          ) : (
            <View style={[styles.successStrip, { backgroundColor: successStripBg }]}>
              <View style={styles.successContent}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} style={{ marginTop: 2 }} />
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
              <Ionicons name="receipt" size={26} color={colors.text} />
              <Text style={[styles.billTitle, { color: colors.text }]}>Total Bill</Text>
            </View>
            <Text style={[styles.billAmount, { color: colors.accentGreen }]}>₹{totalAmountDisplay}</Text>
            <Ionicons
              name={isOrderSummaryExpanded ? 'chevron-up' : 'chevron-down'}
              size={24}
              color={colors.textTertiary}
            />
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
                    const statusLabel = getStatusText(currentOrder?.status) || '—';

                    return (
                      <View key={index} style={styles.tableRow}>
                        <View style={styles.tableColumnItem}>
                          <Text style={[styles.tableCellItem, { color: colors.text }]}>{name}</Text>
                        </View>
                        <View style={styles.tableColumnQty}>
                          <Text style={[styles.tableCellQty, { color: colors.text }]}>{qty}</Text>
                        </View>
                        <View style={styles.tableColumnPrice}>
                          <Text style={[styles.tableCellPrice, { color: colors.accentGreen }]}>{priceStr}</Text>
                        </View>
                        <View style={styles.tableColumnStatus}>
                          <Text style={[styles.tableCellStatus, { color: colors.textSecondary }]} numberOfLines={1}>{statusLabel}</Text>
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
                <View style={[
                  styles.timelineCircle,
                  { 
                    backgroundColor: step.completed ? (step.color || colors.success) : colors.textTertiary,
                    borderColor: step.completed
                      ? (isDarkMode ? 'rgba(16, 185, 129, 0.45)' : '#D4FFDA')
                      : colors.border
                  }
                ]}>
                  <Ionicons 
                    name={
                      step.id === 1 ? 'checkmark-circle' :
                      step.id === 2 ? 'document-text' :
                      step.id === 3 ? 'bag' : 'person'
                    } 
                    size={15} 
                    color={step.completed ? '#FFFFFF' : colors.textSecondary} 
                  />
                </View>
                {index < timeline.length - 1 && (
                  <View style={[
                    styles.timelineLine,
                    { backgroundColor: step.completed ? colors.success : colors.textTertiary }
                  ]} />
                )}
              </View>
              
              <View style={styles.timelineContent}>
                <Text style={[styles.timelineTitle, { color: step.color || colors.text }]}>{step.title}</Text>
                <Text style={[styles.timelineDescription, { color: colors.textSecondary }]}>{step.description}</Text>
              </View>
              
              <Text style={[styles.timelineTime, { color: colors.textTertiary }]}>{step.time}</Text>
            </View>
            {step.id === 3 && currentOrder?.status === 'ready' && !isQRExpired() && (
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
              <Ionicons name="refresh" size={16} color="#FFFFFF" />
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
  },
  billTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#212121',
  },
  billAmount: {
    fontSize: 20,
    fontWeight: '700',
    color: '#00B330',
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
  tableColumnItem: { flex: 1, minWidth: 0, paddingRight: 8 },
  tableColumnQty: { width: 40, alignItems: 'center', flexShrink: 0 },
  tableColumnPrice: { width: 82, alignItems: 'center', flexShrink: 0 },
  tableColumnStatus: { width: 76, alignItems: 'flex-end', flexShrink: 0 },
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
  },
  tableCellQty: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333333',
    textAlign: 'center',
    marginTop: 1,
  },
  tableCellPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#00B330',
    textAlign: 'center',
    width: '100%',
    marginTop: 1,
  },
  tableCellStatus: {
    fontSize: 12,
    fontWeight: '600',
    color: '#646464',
    textTransform: 'capitalize',
    marginTop: 2,
    textAlign: 'right',
    flexShrink: 1,
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