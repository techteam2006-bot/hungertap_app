/**
 * History tables after canteen close.
 * - archived_orders / archived_order_items → delivered | cancelled_by_vendor | pickup_failed
 * - failed_orders / failed_order_items → payment_failed
 *
 * Live `orders` / `order_items` keep delivered (and other finals) until close — do NOT assume
 * lines move to archive on status=delivered.
 * Payments/refunds are snapshotted to archived_* on close; terminal live rows are then purged.
 */
export const ARCHIVED_ORDERS_TABLE = 'archived_orders';
export const ARCHIVED_LINE_ITEMS_TABLE = 'archived_order_items';
export const FAILED_ORDERS_TABLE = 'failed_orders';
export const FAILED_LINE_ITEMS_TABLE = 'failed_order_items';

/** @deprecated use ARCHIVED_LINE_ITEMS_TABLE */
export const ARCHIVED_LINE_ITEMS_TABLE_ALIAS = ARCHIVED_LINE_ITEMS_TABLE;

/**
 * Raw archive lines when `items` join is unavailable.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string[]} orderIds
 */
export async function fetchArchivedOrderItemsByOrderIds(supabase, orderIds) {
  try {
    if (!orderIds?.length) {
      return { data: [], error: null };
    }
    const res = await supabase.from(ARCHIVED_LINE_ITEMS_TABLE).select('*').in('order_id', orderIds);
    if (res.error) {
      console.error('fetchArchivedOrderItemsByOrderIds:', res.error.message || res.error);
      return { data: [], error: res.error };
    }
    return { data: res.data || [], error: null };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { data: [], error: null };
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string[]} orderIds
 */
export async function fetchFailedOrderItemsByOrderIds(supabase, orderIds) {
  try {
    if (!orderIds?.length) {
      return { data: [], error: null };
    }
    const res = await supabase.from(FAILED_LINE_ITEMS_TABLE).select('*').in('order_id', orderIds);
    if (res.error) {
      console.error('fetchFailedOrderItemsByOrderIds:', res.error.message || res.error);
      return { data: [], error: res.error };
    }
    return { data: res.data || [], error: null };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { data: [], error: null };
  }
}
