/**
 * Order loading for HungerTap student app — canteen-close archive contract:
 *
 * WHILE OPEN (live):
 *   Query `orders` + `order_items` for all open-day statuses including delivered,
 *   cancelled_by_vendor, payment_failed. Do NOT assume archive on delivered.
 *
 * AFTER CLOSE:
 *   Live rows are deleted; history is in:
 *   - archieved_orders + archieved_order_items (delivered | cancelled_by_vendor | pickup_failed)
 *   - failed_orders + failed_order_items (payment_failed)
 *
 * Never join archieved_order_items to live `orders` (IDs are gone after close).
 */
import {
  ARCHIVED_ORDERS_TABLE,
  ARCHIVED_LINE_ITEMS_TABLE,
  FAILED_ORDERS_TABLE,
  FAILED_LINE_ITEMS_TABLE,
  fetchArchivedOrderItemsByOrderIds,
  fetchFailedOrderItemsByOrderIds,
} from './archivedOrderItems';

/** PostgREST select for a line row plus catalog row from `items`. */
const LINE_WITH_ITEMS = '*, items ( id, name, price, image_url )';

const ORDER_HEADER_SELECT = `
  *,
  canteens ( name )
`;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} table
 * @param {string} orderId
 */
async function fetchLinesForOrder(supabase, table, orderId) {
  try {
    // History tables snapshot item_name on the line — no FK to `items`.
    if (table === ARCHIVED_LINE_ITEMS_TABLE) {
      return fetchArchivedOrderItemsByOrderIds(supabase, [orderId]);
    }
    if (table === FAILED_LINE_ITEMS_TABLE) {
      return fetchFailedOrderItemsByOrderIds(supabase, [orderId]);
    }

    const withJoin = await supabase.from(table).select(LINE_WITH_ITEMS).eq('order_id', orderId);
    if (!withJoin.error) {
      return { data: withJoin.data || [], error: null };
    }
    console.warn('fetchLinesForOrder join failed:', withJoin.error?.message || withJoin.error);
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
    if (!orderIds.length) {
      return { data: [], error: null };
    }
    // Archive / failed lines relate by order_id only — never embed `items`.
    if (table === ARCHIVED_LINE_ITEMS_TABLE) {
      return fetchArchivedOrderItemsByOrderIds(supabase, orderIds);
    }
    if (table === FAILED_LINE_ITEMS_TABLE) {
      return fetchFailedOrderItemsByOrderIds(supabase, orderIds);
    }

    const withJoin = await supabase.from(table).select(LINE_WITH_ITEMS).in('order_id', orderIds);
    if (!withJoin.error) {
      return { data: withJoin.data || [], error: null };
    }
    console.warn('fetchLinesForOrdersIn join failed:', withJoin.error?.message || withJoin.error);
    const fb = await supabase.from(table).select('*').in('order_id', orderIds);
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

function groupLinesByOrderId(rows) {
  const by = {};
  (rows || []).forEach((r) => {
    if (!r?.order_id) return;
    const k = String(r.order_id);
    if (!by[k]) by[k] = [];
    by[k].push(r);
  });
  return by;
}

/** Normalize history header rows to the live-order shape used by UI. */
function normalizeHistoryOrder(row, source) {
  if (!row) return null;
  const originalId = row.order_id || row.id;
  return {
    ...row,
    id: originalId,
    order_id: originalId,
    placed_by: row.placed_by,
    status: row.status,
    _historySource: source,
  };
}

/**
 * Prefer live lines; fall back to archive / failed snapshots when present.
 * @param {object} order
 * @returns {object[]}
 */
export function pickLineRowsFromOrderRow(order) {
  const live = Array.isArray(order?.order_items) ? order.order_items : [];
  const arch = Array.isArray(order?.archived_order_items) ? order.archived_order_items : [];
  const failed = Array.isArray(order?.failed_order_items) ? order.failed_order_items : [];
  if (live.length > 0) return live;
  if (arch.length > 0) return arch;
  if (failed.length > 0) return failed;
  return live;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} orderId
 * @param {string} userId
 */
export async function fetchOrderWithLineJoins(supabase, orderId, userId) {
  try {
    if (!orderId || !userId) {
      return { data: null, error: { message: 'Missing order or user' } };
    }

    // 1) Live open-day row (includes delivered until canteen close)
    const base = await supabase
      .from('orders')
      .select(ORDER_HEADER_SELECT)
      .eq('id', orderId)
      .eq('placed_by', userId)
      .maybeSingle();

    if (base.error) {
      console.error('fetchOrderWithLineJoins live:', base.error.message || base.error);
    }

    if (base.data) {
      const { data: lines, error: lineError } = await fetchLinesForOrder(
        supabase,
        'order_items',
        orderId
      );
      // Keep the header even if line join fails — UI can still show status.
      if (lineError) {
        console.warn(
          'fetchOrderWithLineJoins live lines:',
          lineError.message || lineError
        );
      }
      return {
        data: {
          ...base.data,
          order_items: Array.isArray(lines) ? lines : [],
          archived_order_items: [],
          failed_order_items: [],
          _historySource: 'live',
        },
        error: null,
      };
    }

    // 2) Post-close archive
    const archHeader = await supabase
      .from(ARCHIVED_ORDERS_TABLE)
      .select(ORDER_HEADER_SELECT)
      .eq('placed_by', userId)
      .or(`order_id.eq.${orderId},id.eq.${orderId}`)
      .maybeSingle();

    if (!archHeader.error && archHeader.data) {
      const normalized = normalizeHistoryOrder(archHeader.data, 'archieved');
      const lineOrderId = normalized.id;
      const { data: lines, error: lineError } = await fetchLinesForOrder(
        supabase,
        ARCHIVED_LINE_ITEMS_TABLE,
        lineOrderId
      );
      if (lineError) {
        console.warn(
          'fetchOrderWithLineJoins archive lines:',
          lineError.message || lineError
        );
      }
      return {
        data: {
          ...normalized,
          order_items: [],
          archived_order_items: Array.isArray(lines) ? lines : [],
          failed_order_items: [],
        },
        error: null,
      };
    }

    // 3) Failed payment history
    const failedHeader = await supabase
      .from(FAILED_ORDERS_TABLE)
      .select(ORDER_HEADER_SELECT)
      .eq('placed_by', userId)
      .or(`order_id.eq.${orderId},id.eq.${orderId}`)
      .maybeSingle();

    if (!failedHeader.error && failedHeader.data) {
      const normalized = normalizeHistoryOrder(failedHeader.data, 'failed');
      const lineOrderId = normalized.id;
      const { data: lines, error: lineError } = await fetchLinesForOrder(
        supabase,
        FAILED_LINE_ITEMS_TABLE,
        lineOrderId
      );
      if (lineError) {
        console.warn(
          'fetchOrderWithLineJoins failed lines:',
          lineError.message || lineError
        );
      }
      return {
        data: {
          ...normalized,
          order_items: [],
          archived_order_items: [],
          failed_order_items: Array.isArray(lines) ? lines : [],
        },
        error: null,
      };
    }

    console.warn('No data returned');
    return { data: null, error: { message: 'Order not found' } };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { data: null, error: { message: err?.message || String(err) } };
  }
}

/**
 * List live open-day orders + post-close history for the current user.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 */
export async function fetchUserOrdersWithLineJoins(supabase, userId) {
  try {
    if (!userId) {
      return { data: [], error: { message: 'Missing user' } };
    }

    const [liveRes, archRes, failedRes] = await Promise.all([
      supabase
        .from('orders')
        .select(ORDER_HEADER_SELECT)
        .eq('placed_by', userId)
        .neq('status', 'pending_payment')
        .order('created_at', { ascending: false }),
      supabase
        .from(ARCHIVED_ORDERS_TABLE)
        .select(ORDER_HEADER_SELECT)
        .eq('placed_by', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from(FAILED_ORDERS_TABLE)
        .select(ORDER_HEADER_SELECT)
        .eq('placed_by', userId)
        .order('created_at', { ascending: false }),
    ]);

    if (liveRes.error) {
      console.warn('fetchUserOrdersWithLineJoins live:', liveRes.error.message || liveRes.error);
    }

    if (archRes.error) {
      console.warn(`${ARCHIVED_ORDERS_TABLE}:`, archRes.error.message || archRes.error);
    }
    if (failedRes.error) {
      console.warn(`${FAILED_ORDERS_TABLE}:`, failedRes.error.message || failedRes.error);
    }

    const liveOrders = liveRes.error ? [] : liveRes.data || [];
    const liveIds = liveOrders.map((o) => o.id).filter(Boolean);

    const archOrders = (archRes.error ? [] : archRes.data || [])
      .map((r) => normalizeHistoryOrder(r, 'archieved'))
      .filter(Boolean);
    const failedOrders = (failedRes.error ? [] : failedRes.data || [])
      .map((r) => normalizeHistoryOrder(r, 'failed'))
      .filter(Boolean);

    // Prefer live row when the same id still exists (same day before cleanup)
    const liveIdSet = new Set(liveIds.map(String));
    const historyArch = archOrders.filter((o) => !liveIdSet.has(String(o.id)));
    const historyFailed = failedOrders.filter((o) => !liveIdSet.has(String(o.id)));

    const archIds = historyArch.map((o) => o.id).filter(Boolean);
    const failedIds = historyFailed.map((o) => o.id).filter(Boolean);

    const [liveLinesRes, archLinesRes, failedLinesRes] = await Promise.all([
      fetchLinesForOrdersIn(supabase, 'order_items', liveIds),
      fetchLinesForOrdersIn(supabase, ARCHIVED_LINE_ITEMS_TABLE, archIds),
      fetchLinesForOrdersIn(supabase, FAILED_LINE_ITEMS_TABLE, failedIds),
    ]);

    if (liveLinesRes.error && liveIds.length) {
      console.warn('order_items batch:', liveLinesRes.error.message || liveLinesRes.error);
    }

    const liveBy = groupLinesByOrderId(liveLinesRes.error ? [] : liveLinesRes.data);
    const archBy = groupLinesByOrderId(archLinesRes.error ? [] : archLinesRes.data);
    const failedBy = groupLinesByOrderId(failedLinesRes.error ? [] : failedLinesRes.data);

    const mergedLive = liveOrders.map((o) => ({
      ...o,
      order_items: liveBy[String(o.id)] || [],
      archived_order_items: [],
      failed_order_items: [],
      _historySource: 'live',
    }));

    const mergedArch = historyArch.map((o) => ({
      ...o,
      order_items: [],
      archived_order_items: archBy[String(o.id)] || [],
      failed_order_items: [],
    }));

    const mergedFailed = historyFailed.map((o) => ({
      ...o,
      order_items: [],
      archived_order_items: [],
      failed_order_items: failedBy[String(o.id)] || [],
    }));

    const combined = [...mergedLive, ...mergedArch, ...mergedFailed].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });

    // Prefer history if live query failed entirely but archives succeeded
    if (liveRes.error && combined.length === 0) {
      return { data: [], error: liveRes.error };
    }

    return { data: combined, error: null };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { data: [], error: { message: err?.message || String(err) } };
  }
}
