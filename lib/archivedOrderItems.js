/**
 * Supabase public table for delivered line snapshots. Server name uses "archieved" (typo); PostgREST
 * hint: not `archived_order_items`.
 */
export const ARCHIVED_LINE_ITEMS_TABLE = 'archieved_order_items';

/**
 * Raw rows when `items` join is unavailable.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string[]} orderIds
 */
export async function fetchArchivedOrderItemsByOrderIds(supabase, orderIds) {
  try {
    // ✅ error handled
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
