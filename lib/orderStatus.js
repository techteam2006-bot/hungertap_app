/**
 * Shared order-status helpers for list, detail, filters, and notifications.
 * Backend statuses: pending_payment | payment_failed | preparing | partially_ready |
 * ready | delivered | cancelled_by_vendor | pickup_failed (+ legacy aliases).
 *
 * pickup_failed = ready (or ready lines of partially_ready) not collected at canteen close.
 */

export const ORDER_STATUS = {
  PENDING_PAYMENT: 'pending_payment',
  PAYMENT_FAILED: 'payment_failed',
  PREPARING: 'preparing',
  PARTIALLY_READY: 'partially_ready',
  READY: 'ready',
  DELIVERED: 'delivered',
  CANCELLED_BY_VENDOR: 'cancelled_by_vendor',
  PICKUP_FAILED: 'pickup_failed',
};

/** Filters shown on Orders list (chip row). */
export const ORDER_STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'partially_ready', label: 'Partially ready' },
  { id: 'ready', label: 'Ready' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'pickup_failed', label: 'Not picked up' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function isDeliveredLike(status) {
  return status === 'delivered' || status === 'completed';
}

export function isPickupFailed(status) {
  return status === 'pickup_failed';
}

export function isCancelledLike(status) {
  const s = String(status || '');
  return (
    s === 'cancelled' ||
    s === 'payment_cancelled' ||
    s.startsWith('cancelled_by')
  );
}

export function isPaymentFailedLike(status) {
  return status === 'payment_failed' || status === 'failed';
}

/** Kitchen / in-progress family (not final, not cancelled). */
export function isActiveKitchenStatus(status) {
  return (
    status === 'preparing' ||
    status === 'partially_ready' ||
    status === 'ready' ||
    status === 'confirmed' ||
    status === 'on_way'
  );
}

/** Payment succeeded / order is with kitchen or beyond (checkout success). */
export function isOrderPlacedSuccessStatus(status) {
  return (
    status === 'preparing' ||
    status === 'partially_ready' ||
    status === 'ready' ||
    status === 'delivered' ||
    status === 'completed' ||
    status === 'confirmed'
  );
}

export function isReorderEligibleStatus(status) {
  return (
    isCancelledLike(status) ||
    isPaymentFailedLike(status) ||
    isDeliveredLike(status) ||
    isPickupFailed(status)
  );
}

/** QR / pickup code when fully ready or partially ready. */
export function canShowPickupQr(status) {
  return status === 'ready' || status === 'partially_ready';
}

export function getOrderStatusLabel(status) {
  switch (status) {
    case 'pending_payment':
      return 'Awaiting payment';
    case 'preparing':
      return 'Preparing';
    case 'confirmed':
      return 'Confirmed';
    case 'partially_ready':
      return 'Partially Ready';
    case 'ready':
      return 'Ready to Pickup';
    case 'on_way':
      return 'On the way';
    case 'delivered':
      return 'Delivered';
    case 'completed':
      return 'Completed';
    case 'paid':
      return 'Paid';
    case 'pickup_failed':
      return 'Not Picked Up';
    case 'cancelled':
    case 'cancelled_by_user':
    case 'cancelled_by_admin':
    case 'cancelled_by_system':
    case 'cancelled_by_canteen':
    case 'cancelled_by_vendor':
      return 'Cancelled';
    case 'payment_cancelled':
      return 'Payment Cancelled';
    case 'payment_failed':
    case 'failed':
      return 'Payment Failed';
    default: {
      const s = String(status || '');
      if (s.startsWith('cancelled_by')) {
        return s
          .replace(/_/g, ' ')
          .trim()
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
      if (!s) return 'Preparing';
      return s
        .replace(/_/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
}

/**
 * @param {string} status
 * @param {Record<string, string> | null} [themeColors] theme palette when available
 */
export function getOrderStatusColor(status, themeColors = null) {
  const warning = themeColors?.warning || '#F39C12';
  const info = themeColors?.info || '#4A90E2';
  const success = themeColors?.success || '#00B330';
  const error = themeColors?.error || '#E74C3C';
  const brandYellow = themeColors?.brandYellow || '#F5BC3B';

  switch (status) {
    case 'pending_payment':
      return themeColors ? info : warning;
    case 'preparing':
      return warning;
    case 'confirmed':
      return info;
    case 'partially_ready':
      return brandYellow;
    case 'ready':
      return themeColors ? success : info;
    case 'on_way':
      return info;
    case 'delivered':
    case 'completed':
    case 'paid':
      return success;
    case 'pickup_failed':
      return warning;
    case 'payment_cancelled':
    case 'payment_failed':
    case 'failed':
    case 'cancelled':
    case 'cancelled_by_user':
    case 'cancelled_by_admin':
    case 'cancelled_by_system':
    case 'cancelled_by_canteen':
    case 'cancelled_by_vendor':
      return error;
    default:
      if (String(status || '').startsWith('cancelled_by')) return error;
      return warning;
  }
}

export function getOrderStatusIcon(status) {
  if (isDeliveredLike(status)) return 'checkmark-circle';
  if (isCancelledLike(status) || isPaymentFailedLike(status)) return 'close-circle';
  if (isPickupFailed(status)) return 'close-circle';
  if (status === 'partially_ready') return 'restaurant';
  if (status === 'ready') return 'checkmark-circle';
  return 'time-outline';
}

/** 0–100 progress for list bars. partially_ready sits between preparing and ready. */
export function getOrderStatusProgress(status) {
  switch (status) {
    case 'pending_payment':
      return 10;
    case 'preparing':
      return 25;
    case 'confirmed':
      return 40;
    case 'partially_ready':
      return 55;
    case 'ready':
    case 'on_way':
      return 85;
    case 'delivered':
    case 'completed':
    case 'paid':
      return 100;
    case 'pickup_failed':
      return 85;
    case 'cancelled':
    case 'payment_cancelled':
    case 'payment_failed':
    case 'failed':
      return 0;
    default:
      if (isCancelledLike(status)) return 0;
      return 25;
  }
}

export function getOrderActionButtonText(status) {
  if (isDeliveredLike(status) || isPickupFailed(status)) return 'Re Order';
  if (isCancelledLike(status) || isPaymentFailedLike(status)) return 'Order Again';
  if (isActiveKitchenStatus(status) || status === 'pending_payment') return 'Track Status';
  return 'Track Status';
}

/**
 * Timeline step index for Order Status screen.
 * 1 placed/pending → 2 preparing → 2.5 conceptually partial (still < 3) → 3 ready → 4 delivered
 * Returns integer steps; partially_ready stays on preparing rung (2) so Ready is not marked complete.
 */
export function getOrderTimelineStep(status) {
  if (isCancelledLike(status) || isPaymentFailedLike(status)) return 0;
  switch (status) {
    case 'pending_payment':
      return 1;
    case 'preparing':
    case 'confirmed':
    case 'partially_ready':
      return 2;
    case 'ready':
    case 'on_way':
    case 'pickup_failed':
      return 3;
    case 'delivered':
    case 'completed':
    case 'paid':
      return 4;
    default:
      return 2;
  }
}

export function isPartiallyReady(status) {
  return status === 'partially_ready';
}

/** Local / push notification body for status changes. Optional item summary for richer banners. */
export function getOrderStatusNotificationBody(status, itemSummary = '') {
  const items = String(itemSummary || '').trim();
  switch (status) {
    case 'accepted':
      return 'Order accepted';
    case 'preparing':
      return items ? `Preparing: ${items}` : 'Food is being prepared';
    case 'partially_ready':
      return items
        ? `Some items ready: ${items}`
        : 'Some items in your order are ready';
    case 'ready':
      return items ? `Ready for pickup: ${items}` : 'Your order is ready for pickup!';
    case 'delivered':
      return items ? `Delivered: ${items}` : 'Your order has been delivered!';
    case 'pickup_failed':
      return items
        ? `Not picked up before canteen closed: ${items}`
        : 'Your order was not picked up before the canteen closed';
    case 'cancelled':
    case 'cancelled_by_user':
    case 'cancelled_by_admin':
    case 'cancelled_by_system':
    case 'cancelled_by_canteen':
    case 'cancelled_by_vendor':
    case 'payment_cancelled':
      return items ? `Order cancelled: ${items}` : 'Your order was cancelled';
    default:
      return 'Status updated';
  }
}

export function isNotifiableOrderStatus(status) {
  const s = String(status || '');
  return (
    s === 'preparing' ||
    s === 'partially_ready' ||
    s === 'ready' ||
    s === 'delivered' ||
    s === 'pickup_failed' ||
    s === 'cancelled' ||
    s === 'payment_cancelled' ||
    s.startsWith('cancelled_by')
  );
}

export function orderMatchesStatusFilter(orderStatus, filterId) {
  if (filterId === 'all') return true;
  if (filterId === 'cancelled') {
    return isCancelledLike(orderStatus) || isPaymentFailedLike(orderStatus);
  }
  if (filterId === 'delivered') {
    return isDeliveredLike(orderStatus);
  }
  return orderStatus === filterId;
}
