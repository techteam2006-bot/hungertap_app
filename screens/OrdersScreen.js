import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Image,
  TextInput,
  Animated,
  RefreshControl,
} from 'react-native';
import Constants from 'expo-constants';
import AppIcon from '../components/AppIcon';
import { useTheme } from '../lib/ThemeContext';
import { useAuth } from '../lib/AuthContext';
import { useCart } from '../lib/CartContext';
import { supabase, deriveItemIsAvailable } from '../lib/supabase';
import { fetchUserOrdersWithLineJoins, pickLineRowsFromOrderRow } from '../lib/orderQueries';
import { getLineItemIdFromRow, resolveOrderHeaderTotalFromRows } from '../lib/orderLineRowMoney';
import { pxToPercentX, pxToPercentY } from '../utils/percent';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appTypography } from '../lib/darkThemeConfig';
import PageLoader from '../components/PageLoader';
import LoadingSpinner from '../components/LoadingSpinner';
const OrdersScreen = ({ navigation }) => {
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { addToCart, clearCart, getTotalItems } = useCart();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeStatus, setActiveStatus] = useState('all');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [reorderingOrderId, setReorderingOrderId] = useState(null);
  const searchInputRef = useRef(null);
  const isFetchingRef = useRef(false);
  const pollingIntervalRef = useRef(null);

  // Handle expanded search area click
  const handleSearchAreaPress = () => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
      setIsSearchFocused(true);
    }
  };

  const fetchOrders = async (options = { silent: false, updatedOrderId: null }) => {
    try {
      // ✅ crash prevention added — no user ⇒ skip protected calls
      if (!user?.id) {
        setOrders([]);
        if (!options.silent) setLoading(false);
        isFetchingRef.current = false;
        return;
      }

      if (!options.silent) setLoading(true);
      isFetchingRef.current = true;
      
      console.log('🔍 Fetching orders for user:', user?.id);
      
      const { data: ordersData, error: ordersError } = await fetchUserOrdersWithLineJoins(
        supabase,
        user.id
      );

      if (ordersError) {
        console.error('❌ Error fetching orders:', ordersError);
        Alert.alert('Error', 'Failed to load orders');
      } else {
        console.log('✅ Orders fetched successfully:', ordersData?.length || 0);
        const lineName = (oi) => String(oi?.item_name || oi?.items?.name || 'Item').trim();

        const deliveredIdsNeedingSnapshot = [];

        const mapped = (ordersData || []).map((order) => {
          const rows = pickLineRowsFromOrderRow(order);
          const counts = {};
          for (const oi of rows) {
            const name = lineName(oi);
            if (!name) continue;
            const quantity = Number(oi?.quantity ?? 1) || 1;
            counts[name] = (counts[name] || 0) + quantity;
          }
          const itemSummaryFromRows = Object.entries(counts)
            .map(([name, qty]) => `${name} (${qty})`)
            .join(', ');

          const itemCount =
            order.item_count ||
            rows.reduce((sum, oi) => sum + (Number(oi?.quantity ?? 1) || 1), 0);

          const isDeliveredLike =
            order.status === 'delivered' || order.status === 'completed';

          const persistedItemName =
            order.item_name != null && String(order.item_name).trim() !== ''
              ? String(order.item_name).trim()
              : null;

          let total_amount = resolveOrderHeaderTotalFromRows(order, rows);
          let item_name = persistedItemName || itemSummaryFromRows || null;

          if (isDeliveredLike) {
            if (
              !(Number.isFinite(total_amount) && total_amount > 0) ||
              !item_name
            ) {
              deliveredIdsNeedingSnapshot.push(order.id);
            }
          }

          return {
            ...order,
            item_name,
            total_amount,
            item_count: itemCount,
            user_id: order.placed_by,
          };
        });

        let merged = mapped;
        if (deliveredIdsNeedingSnapshot.length > 0) {
          try {
            const { data: archRows, error: archErr } = await supabase
              .from('archived_orders')
              .select('order_id, total_amount, item_name')
              .in('order_id', deliveredIdsNeedingSnapshot);
            if (!archErr && Array.isArray(archRows) && archRows.length > 0) {
              const byId = Object.fromEntries(archRows.map((r) => [r.order_id, r]));
              merged = mapped.map((o) => {
                const ar = byId[o.id];
                if (!ar) return o;
                const isDel = o.status === 'delivered' || o.status === 'completed';
                if (!isDel) return o;
                let next = { ...o };
                const at = ar.total_amount != null ? Number(ar.total_amount) : NaN;
                if (Number.isFinite(at) && at > 0 && !(Number.isFinite(o.total_amount) && o.total_amount > 0)) {
                  next = { ...next, total_amount: Number(at.toFixed(2)) };
                }
                if (ar.item_name != null && String(ar.item_name).trim() !== '' && !o.item_name) {
                  next = { ...next, item_name: String(ar.item_name).trim() };
                }
                return next;
              });
            }
          } catch (_) {
            /* archived_orders may not exist */
          }
        }

        setOrders(merged);
      }
    } catch (error) {
      console.error('❌ Error fetching orders:', error);
      Alert.alert('Error', 'Failed to load orders');
    } finally {
      isFetchingRef.current = false;
      if (!options.silent) setLoading(false);
    }
  };


  // Real-time subscription for orders
  useEffect(() => {
    if (!user?.id) return;

    console.log('🔔 Setting up real-time subscription for orders, user:', user.id);

    const channel = supabase
      .channel('orders_realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'orders',
        filter: `placed_by=eq.${user.id}`,
      }, (payload) => {
        console.log('📦 New order received via real-time:', payload);
        fetchOrders({ silent: true });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `placed_by=eq.${user.id}`,
      }, (payload) => {
        console.log('📦 Order updated via real-time:', payload);
        fetchOrders({ silent: true });
      })
      .subscribe();

    return () => {
      console.log('🔔 Unsubscribing from orders real-time');
      channel.unsubscribe();
    };
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchOrders();

      // DISABLED: Fast fallback polling every 2s - was causing infinite loop
      // if (pollingIntervalRef.current) {
      //   clearInterval(pollingIntervalRef.current);
      //   pollingIntervalRef.current = null;
      // }
      // pollingIntervalRef.current = setInterval(() => {
      //   if (!isFetchingRef.current) {
      //     fetchOrders({ silent: true });
      //   }
      // }, 2000);
    }
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [user?.id]);

  const onRefresh = useCallback(async () => {
    if (!user?.id) return;
    setRefreshing(true);
    try {
      await fetchOrders({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [user?.id]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'preparing':
        return '#F39C12'; // Orange
      case 'confirmed':
        return '#4A90E2'; // Blue
      case 'ready':
        return '#4A90E2'; // Blue
      case 'delivered':
      case 'completed':
        return '#00B330'; // Dark Green
      case 'cancelled':
      case 'payment_cancelled':
        return '#95A5A6'; // Gray
      case 'pending_payment':
        return '#F39C12';
      case 'payment_failed':
      case 'failed':
        return '#E74C3C'; // Red
      default:
        return '#F39C12'; // Default to orange for preparing
    }
  };

  const getStatusIcon = (status) => {
    // Keep the same icon for all statuses, only change color
    return 'time-outline';
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'pending_payment':
        return 'Awaiting payment';
      case 'preparing':
        return 'Preparing';
      case 'confirmed':
        return 'Confirmed';
      case 'ready':
        return 'Ready to Pickup';
      case 'delivered':
        return 'Delivered';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      case 'payment_cancelled':
        return 'Payment Cancelled';
      case 'payment_failed':
      case 'failed':
        return 'Payment Failed';
      default:
        return 'Preparing';
    }
  };

  const getActionButtonText = (status) => {
    switch (status) {
      case 'confirmed':
      case 'preparing':
      case 'ready':
        return 'Track Status';
      case 'delivered':
      case 'completed':
        return 'Re Order';
      case 'cancelled':
      case 'payment_cancelled':
      case 'payment_failed':
      case 'failed':
        return 'Order Again';
      default:
        return 'Track Status';
    }
  };

  const getStatusProgress = (status) => {
    switch (status) {
      case 'preparing':
        return 25; // Start at 25% (pending removed, preparing is first step)
      case 'confirmed':
        return 50;
      case 'ready':
        return 85;
      case 'delivered':
      case 'completed':
        return 100;
      case 'cancelled':
        return 0;
      default:
        return 25; // Default to preparing progress
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return `Ordered: ${date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })}, ${date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })}`;
  };

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

  const handleReorder = async (order) => {
    if (!order?.id) return;
    if (reorderingOrderId) return;

    const lineRows = pickLineRowsFromOrderRow(order);
    const itemIds = Array.from(
      new Set(lineRows.map((row) => getLineItemIdFromRow(row)).filter(Boolean))
    );

    if (itemIds.length === 0) {
      Alert.alert('Unable to Reorder', 'No reorderable items were found for this order.');
      return;
    }

    setReorderingOrderId(order.id);
    try {
      const { data: itemsData, error } = await supabase
        .from('items')
        .select('id, name, price, image_url, available_stock')
        .in('id', itemIds);

      if (error) {
        console.error('RPC Error:', error.message || error);
        Alert.alert('Error', 'Could not load these items right now. Please try again.');
        return;
      }
      if (!Array.isArray(itemsData)) {
        console.warn('No data returned');
        Alert.alert('Error', 'Could not load menu items to reorder.');
        return;
      }

      const itemById = new Map(itemsData.map((item) => [item?.id, item]).filter(([id]) => id));
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
        setReorderingOrderId(null);
        Alert.alert(
          'Replace cart?',
          'Your cart already has items. Clear your current cart and add items from this order instead?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Clear cart & add',
              style: 'destructive',
              onPress: async () => {
                setReorderingOrderId(order.id);
                try {
                  await applyReorder();
                } catch (reorderError) {
                  if (__DEV__) {
                    console.error('Reorder failed:', reorderError);
                  }
                  Alert.alert('Reorder Failed', 'Could not update your cart. Please try again.');
                } finally {
                  setReorderingOrderId(null);
                }
              },
            },
          ]
        );
        return;
      }

      await applyReorder();
    } catch (reorderError) {
      if (__DEV__) {
        console.error('Reorder failed:', reorderError);
      }
      Alert.alert('Reorder Failed', 'Could not add items to cart. Please try again.');
    } finally {
      setReorderingOrderId(null);
    }
  };

  const renderOrderItem = (order) => {
    const summaryItems = parseOrderSummary(order.item_name);
    const summaryText = summaryItems.length
      ? summaryItems.map(item => `${item.name} x${item.quantity}`).join(', ')
      : 'Items unavailable';
    const itemImage = 'https://imgs.search.brave.com/H0EimZaFKTJOiXJSOVv8oSPdubhwLF8M2SSwS__EhPM/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly90NC5m/dGNkbi5uZXQvanBn/LzA5LzE1LzIyLzk5/LzM2MF9GXzkxNTIy/OTk0M18yNnlGb0FJ/ZEVsUjVRMWNmNXF1/WkswNGp6RldNY2Jy/OS5qcGc';
    const isFinalStatus = order.status === 'delivered' || order.status === 'completed';
    const canReorder = ['cancelled', 'payment_cancelled', 'payment_failed', 'failed', 'delivered', 'completed'].includes(order.status);
    const canteenName = order?.canteens?.name || 'HungerTap, Hyderabad';

    const handleViewOrder = () => {
      navigation.navigate('OrderStatus', { 
        order: {
          ...order,
          orderNumber: order.order_token || String(Math.floor(Math.random() * 9000) + 1000),
          time: new Date(order.created_at).toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
          }),
          date: new Date(order.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          }),
          total: order.total_amount,
          items: summaryItems,
          image: itemImage
        }
      });
    };

    return (
      <View
        style={[
          styles.orderCard,
          {
            backgroundColor: colors.elevatedSurface,
            shadowColor: colors.shadow,
            borderColor: colors.border,
          },
        ]}
      >
        
        <View style={[styles.statusBadge, { backgroundColor: colors.glassSurface }]}>
          <AppIcon 
            name={getStatusIcon(order.status)} 
            size={14} 
            color={getStatusColor(order.status)} 
          />
          <Text style={[styles.statusBadgeText, { color: getStatusColor(order.status) }]}>
            {getStatusText(order.status)}
          </Text>
        </View>
        
        <View style={styles.orderContent}>
          <View style={styles.imageContainer}>
            <Image source={{ uri: itemImage }} style={styles.orderImage} />
          </View>
          
          <View style={styles.orderDetails}>
            <Text style={[styles.orderNumber, { color: colors.text }]}>
              Order #{order.order_token || String(Math.floor(Math.random() * 9000) + 1000)}
            </Text>
            
            <View style={styles.locationRow}>
              <AppIcon name="location-outline" size={12} color="#FF0000" />
              <Text style={[styles.locationText, { color: colors.textSecondary }]}>{canteenName}</Text>
            </View>

            <Text style={[styles.orderSummaryText, { color: colors.textSecondary }]} numberOfLines={2}>
              {summaryText}
            </Text>
          </View>
        </View>

        <View style={styles.orderBottomSection}>
          <Text style={[styles.orderTimeText, { color: colors.textSecondary }]}>
            {formatDate(order.created_at)}
          </Text>
          <Text style={[styles.billTotalText, { color: colors.textSecondary }]}>
            Bill Total: ₹
            {Number.isFinite(Number(order.total_amount))
              ? Number(order.total_amount).toFixed(2)
              : '0.00'}
          </Text>
        </View>
        
        <View style={styles.actionButtonContainer}>
          {canReorder ? (
            <View style={styles.deliveredButtonsContainer}>
              <TouchableOpacity style={[styles.actionButton, styles.viewButton]} onPress={handleViewOrder}>
                <Text style={[styles.actionButtonText, { color: colors.text }]}>View</Text>
                <AppIcon name="eye-outline" size={16} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.reorderButton]}
                onPress={() => handleReorder(order)}
                disabled={reorderingOrderId === order.id}
              >
                {reorderingOrderId === order.id ? (
                  <LoadingSpinner size="small" color="#000000" style={{ marginRight: 8 }} />
                ) : null}
                <Text style={styles.actionButtonText}>
                  {reorderingOrderId === order.id ? 'Reordering...' : 'Reorder'}
                </Text>
                {reorderingOrderId !== order.id ? (
                  <AppIcon name="refresh" size={16} color="#000000" />
                ) : null}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              style={[
                styles.actionButton,
                isFinalStatus && styles.viewButton
              ]}
              onPress={handleViewOrder}
            >
              <Text style={[styles.actionButtonText, isFinalStatus && { color: colors.text }]}>
                {isFinalStatus ? 'View' : getActionButtonText(order.status)}
              </Text>
              <AppIcon 
                name={isFinalStatus ? 'eye-outline' : 'chevron-forward'} 
                size={16} 
                color={isFinalStatus ? colors.text : "#000000"} 
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <AppIcon name="receipt-outline" size={64} color={colors.textTertiary} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>No Orders Yet</Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        Your order history will appear here
      </Text>
    </View>
  );

  const statusFilters = useMemo(
    () => [
      { id: 'all', label: 'All' },
      { id: 'preparing', label: 'Preparing' },
      { id: 'ready', label: 'Ready' },
      { id: 'delivered', label: 'Delivered' },
      { id: 'cancelled', label: 'Cancelled' },
    ],
    []
  );

  const filteredOrders = useMemo(() => {
    const q = debouncedQuery;
    return orders.filter((order) => {
      if (order.status === 'pending_payment') return false;
      const statusOk = activeStatus === 'all' ? true : order.status === activeStatus;
      if (!statusOk) return false;
      if (!q) return true;
      const token = String(order.order_token || '').toLowerCase();
      const itemsText = parseOrderSummary(order.item_name)
        .map((i) => String(i.name || '').toLowerCase())
        .join(' ');
      return (
        token.includes(q) ||
        itemsText.includes(q) ||
        String(order.status || '').toLowerCase().includes(q)
      );
    });
  }, [orders, debouncedQuery, activeStatus, parseOrderSummary]);

  return (
    <View style={[styles.container, { backgroundColor: colors.pageBackground }]}>
      {/* Top status strip */}
      <View style={[styles.topStrip, { backgroundColor: colors.brandYellow }]} />
      
      {/* Header — back (32) + title (flex) + spacer (32) for true horizontal center */}
      <View
        style={[
          styles.header,
          styles.sectionBorderBottom,
          { backgroundColor: colors.elevatedSurface },
        ]}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppIcon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          Your Orders
        </Text>
        <TouchableOpacity
          onPress={onRefresh}
          style={styles.headerIconButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Refresh orders"
          disabled={refreshing || loading}
        >
          <AppIcon
            name="refresh"
            size={22}
            color={colors.text}
            style={refreshing ? { opacity: 0.45 } : undefined}
          />
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <TouchableOpacity
        style={[
          styles.searchContainer,
          styles.sectionBorderBottom,
          { backgroundColor: colors.elevatedSurface },
        ]}
        onPress={handleSearchAreaPress}
        activeOpacity={0.7}
      >
        <View style={[
          styles.searchBar,
          isDarkMode && !isSearchFocused
            ? {
                backgroundColor: 'rgba(0, 0, 0, 0.92)',
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: '#000000',
              }
            : !isSearchFocused && !isDarkMode && { backgroundColor: colors.mutedRowBackground },
          isSearchFocused && [
            styles.searchBarFocused,
            { backgroundColor: colors.searchFocusedTint },
          ],
        ]}>
          <AppIcon name="search" size={20} color={colors.textTertiary} />
          <TextInput
            ref={searchInputRef}
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search orders by item name, token, or status..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            clearButtonMode="while-editing"
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            selectTextOnFocus={true}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.clearButton}
            >
              <AppIcon name="close-circle" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>

      {/* Status categories (filters) */}
      <View
        style={[
          styles.filtersContainer,
          styles.sectionBorderBottom,
          { backgroundColor: colors.elevatedSurface },
        ]}
      >
        <FlatList
          data={statusFilters}
          renderItem={({ item }) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => setActiveStatus(item.id)}
              style={[
                styles.filterButton,
                { backgroundColor: colors.mutedRowBackground, borderColor: colors.border },
                activeStatus === item.id && {
                  backgroundColor: colors.brandYellow,
                  borderColor: colors.brandYellow,
                },
              ]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterButtonText,
                  { color: colors.textSecondary },
                  activeStatus === item.id && {
                    color: '#000000',
                    fontFamily: appTypography.semiBold,
                  },
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersList}
        />
      </View>

      {/* Orders List */}
      {loading ? (
        <PageLoader compact message="Loading your orders..." style={styles.loadingContainer} />
      ) : (
        <FlatList
          data={filteredOrders}
          renderItem={({ item }) => renderOrderItem(item)}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContainer,
            filteredOrders.length === 0 && styles.listContainerEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.text}
              colors={[colors.brandYellow || '#f5bc3b']}
              progressBackgroundColor={colors.elevatedSurface}
            />
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F8',
  },
  topStrip: {
    height: 34,
    backgroundColor: '#f5bc3b',
  },
  sectionBorderBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'white',
  },
  backButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    textAlign: 'center',
    color: '#4D4D4D',
    fontSize: 20,
    fontFamily: appTypography.bold,
    flex: 1,
  },
  headerIconButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'white',
    marginTop: 0,
  },
  searchBarFocused: {
    borderColor: '#000000',
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#FFF5F0',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 0,
    height: 50,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#000000',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    fontFamily: appTypography.regular,
    color: '#333',
    height: '100%',
    paddingVertical: 0,
    includeFontPadding: false,
  },
  clearButton: {
    padding: 4,
    marginLeft: 8,
  },
  filtersContainer: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'white',
  },
  filtersList: {
    paddingRight: 20,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#000000',
    marginRight: 12,
  },
  filterButtonText: {
    fontSize: 14,
    color: '#666',
    fontFamily: appTypography.medium,
  },
  listContainer: {
    padding: 20,
    paddingBottom: 5,
  },
  listContainerEmpty: {
    flexGrow: 1,
  },
  orderCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#000000',
  },
  statusStrip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  statusBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 11,
    fontFamily: appTypography.semiBold,
    marginLeft: 4,
  },
  orderContent: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  imageContainer: {
    marginRight: 12,
  },
  orderImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  orderDetails: {
    flex: 1,
  },
  orderNumber: {
    fontSize: 16,
    fontFamily: appTypography.bold,
    color: '#333',
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  locationText: {
    fontSize: 12,
    fontFamily: appTypography.regular,
    color: '#666',
    marginLeft: 4,
  },
  orderSummaryText: {
    fontSize: 12,
    fontFamily: appTypography.regular,
    color: '#666',
    marginTop: 4,
  },
  orderDate: {
    fontSize: 12,
    fontFamily: appTypography.regular,
    color: '#666',
    marginBottom: 8,
  },
  orderBottomSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  orderTimeText: {
    fontSize: 12,
    color: '#666',
    fontFamily: appTypography.bold,
  },
  billTotalText: {
    fontSize: 12,
    color: '#666',
    fontFamily: appTypography.medium,
  },
  actionButtonContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    alignItems: 'center',
    width: '100%',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D4A017',
    paddingVertical: 12,
    borderRadius: 14,
    width: '100%',
    justifyContent: 'center',
    marginTop: 14,
  },
  actionButtonText: {
    color: '#000000',
    fontSize: 14,
    fontFamily: appTypography.bold,
    marginRight: 6,
  },
  deliveredButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    justifyContent: 'center',
  },
  viewButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#D4A017',
    borderRadius: 14,
    paddingVertical: 12,
    flex: 1,
    justifyContent: 'center',
  },
  reorderButton: {
    backgroundColor: '#D4A017',
    borderRadius: 14,
    paddingVertical: 12,
    flex: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: appTypography.semiBold,
    marginTop: 16,
    marginBottom: 8,
    color: '#333',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: appTypography.regular,
    textAlign: 'center',
    color: '#666',
  },
  loadingContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
});

export default OrdersScreen;
 
