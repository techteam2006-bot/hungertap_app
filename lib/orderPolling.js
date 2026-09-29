/**
 * Order status refresh WITHOUT Supabase Realtime.
 *
 * The student app no longer opens Realtime connections, so the project's
 * Realtime quota (concurrent connections + messages/sec) is left for the
 * canteen / kitchen / token panels. Students get updates by:
 *   1. a refetch whenever the screen opens or the app comes back to foreground,
 *   2. a refetch when an order push notification arrives while the app is open,
 *   3. a slow poll, only while the screen is open, the app is in the
 *      foreground, and the order is still in progress (stops once final).
 */
import { isDeliveredLike, isCancelledLike, isPaymentFailedLike, isPickupFailed } from './orderStatus';

/** Order Status screen: one small request per open screen every 15 s. */
export const ORDER_STATUS_POLL_MS = 15000;
/** My Orders list: every 30 s, and only while some order is still active. */
export const ORDERS_LIST_POLL_MS = 30000;

/** No further changes expected — stop polling. */
export function isFinalOrderStatus(status) {
  const s = String(status || '');
  if (!s) return false;
  return isDeliveredLike(s) || isCancelledLike(s) || isPaymentFailedLike(s) || isPickupFailed(s);
}
