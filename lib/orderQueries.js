/**
 * Order line items are loaded by **order status**:
 * - `delivered` / `completed` → table {@link ARCHIVED_LINE_ITEMS_TABLE} (`archieved_order_items` in DB) + `items`
 * - all other statuses → `order_items` with `items`
 *
 * In-app we still assign rows to `order.archived_order_items` (property name) for a stable UI shape.
 */
import {
  ARCHIVED_LINE_ITEMS_TABLE,
  fetchArchivedOrderItemsByOrderIds,
} from './archivedOrderItems';

/** PostgREST select for a line row plus catalog row from `items`. */
const LINE_WITH_ITEMS = '*, items ( id, name, price, image_url )';

const isDeliveredLike = (status) =>
  status === 'delivered' || status === 'completed';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} table
 * @param {string} orderId
 */
async function fetchLinesForOrder(supabase, table, orderId) {
  try {
    // ✅ error handled
    const withJoin = await supabase.from(table).select(LINE_WITH_ITEMS).eq('order_id', orderId);
    if (!withJoin.error) {
      return { data: withJoin.data || [], error: null };
    }
    console.error('fetchLinesForOrder join failed:', withJoin.error?.message || withJoin.error);
    const raw = await supabase.from(table).select('*').eq('order_id', orderId);
    if (raw.error) {
      console.error('fetchLinesForOrder raw:', raw.error?.message || raw.error);
      return { data: [], error: raw.error };
    }
    return { data: raw.data || [], error: null };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { data: [], error: null };
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} table
 * @param {string[]} orderIds
 */
async function fetchLinesForOrdersIn(supabase, table, orderIds) {
  try {
    // ✅ error handled
    if (!orderIds.length) {
      return { data: [], error: null };
    }
    const withJoin = await supabase.from(table).select(LINE_WITH_ITEMS).in('order_id', orderIds);
    if (!withJoin.error) {
      return { data: withJoin.data || [], error: null };
    }
    console.error('fetchLinesForOrdersIn join failed:', withJoin.error?.message || withJoin.error);
    if (table === ARCHIVED_LINE_ITEMS_TABLE) {
      return fetchArchivedOrderItemsByOrderIds(supabase, orderIds);
    }
    const fb = await supabase.from('order_items').select('*').in('order_id', orderIds);
    if (fb.error) {
      console.error('fetchLinesForOrdersIn fallback:', fb.error?.message || fb.error);
      return { data: [], error: fb.error };
    }
    return { data: fb.data || [], error: null };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { data: [], error: null };
  }
}

/**
 * @param {object} order
 * @returns {object[]} Line rows for UI: archive lines for final orders, else live `order_items`
 */
export function pickLineRowsFromOrderRow(order) {
  const live = Array.isArray(order?.order_items) ? order.order_items : [];
  const arch = Array.isArray(order?.archived_order_items) ? order.archived_order_items : [];
  if (isDeliveredLike(order?.status)) {
    if (arch.length > 0) return arch;
    return live;
  }
  return live;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} orderId
 * @param {string} userId
 */
export async function fetchOrderWithLineJoins(supabase, orderId, userId) {
  try {
    // ✅ error handled — auth/session implied by caller (guarded userId)
    if (!orderId || !userId) {
      return { data: null, error: { message: 'Missing order or user' } };
    }

    const base = await supabase
      .from('orders')
      .select(
        `
      *,
      canteens ( name )
    `
      )
      .eq('id', orderId)
      .eq('placed_by', userId)
      .single();

    if (base.error) {
      console.error('fetchOrderWithLineJoins base:', base.error.message || base.error);
      return { data: null, error: base.error };
    }
    if (!base.data) {
      console.warn('No data returned');
      return { data: null, error: { message: 'Order not found' } };
    }

    const order = base.data;

    if (isDeliveredLike(order.status)) {
      const { data: lines, error: lineError } = await fetchLinesForOrder(
        supabase,
        ARCHIVED_LINE_ITEMS_TABLE,
        orderId
      );
      if (lineError) {
        return { data: null, error: lineError };
      }
      return {
        data: {
          ...order,
          order_items: [],
          archived_order_items: lines,
        },
        error: null,
      };
    }

    const { data: lines, error: lineError } = await fetchLinesForOrder(supabase, 'order_items', orderId);
    if (lineError) {
      return { data: null, error: lineError };
    }
    return {
      data: {
        ...order,
        order_items: lines,
        archived_order_items: [],
      },
      error: null,
    };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { data: null, error: { message: err?.message || String(err) } };
  }
}

/**
 * List all orders for the current user: line rows from delivered snapshot table or `order_items` by status.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 */
export async function fetchUserOrdersWithLineJoins(supabase, userId) {
  try {
    // ✅ error handled
    if (!userId) {
      return { data: [], error: { message: 'Missing user' } };
    }

    const { data: list, error: listError } = await supabase
      .from('orders')
      .select(
        `
      *,
      canteens ( name )
    `
      )
      .eq('placed_by', userId)
      .neq('status', 'pending_payment')
      .order('created_at', { ascending: false });

    if (listError) {
      console.error('fetchUserOrdersWithLineJoins list:', listError.message || listError);
      return { data: [], error: listError };
    }

    const orders = list || [];
    const deliveredIds = orders.filter((o) => isDeliveredLike(o.status)).map((o) => o.id).filter(Boolean);
    const activeIds = orders.filter((o) => !isDeliveredLike(o.status)).map((o) => o.id).filter(Boolean);

    const [archRes, liveRes] = await Promise.all([
      fetchLinesForOrdersIn(supabase, ARCHIVED_LINE_ITEMS_TABLE, deliveredIds),
      fetchLinesForOrdersIn(supabase, 'order_items', activeIds),
    ]);

    if (archRes.error && deliveredIds.length) {
      console.warn(`${ARCHIVED_LINE_ITEMS_TABLE} batch:`, archRes.error.message || archRes.error);
    }
    if (liveRes.error && activeIds.length) {
      console.error('order_items batch:', liveRes.error.message || liveRes.error);
      return { data: [], error: liveRes.error };
    }

    const archBy = {};
    (archRes.error ? [] : archRes.data || []).forEach((r) => {
      if (!r?.order_id) return;
      const k = String(r.order_id);
      if (!archBy[k]) archBy[k] = [];
      archBy[k].push(r);
    });

    const liveBy = {};
    (liveRes.error ? [] : liveRes.data || []).forEach((r) => {
      if (!r?.order_id) return;
      const k = String(r.order_id);
      if (!liveBy[k]) liveBy[k] = [];
      liveBy[k].push(r);
    });

    const merged = orders.map((o) => {
      const id = String(o.id);
      if (isDeliveredLike(o.status)) {
        return {
          ...o,
          order_items: [],
          archived_order_items: archBy[id] || [],
        };
      }
      return {
        ...o,
        order_items: liveBy[id] || [],
        archived_order_items: [],
      };
    });

    return { data: merged, error: null };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { data: [], error: { message: err?.message || String(err) } };
  }
}
