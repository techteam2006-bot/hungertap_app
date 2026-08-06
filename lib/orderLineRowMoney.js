/**
 * Map money fields from `order_items` / `archieved_order_items` (names vary by migration).
 */
const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/[^0-9.-]/g, '')) : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const LINE_SUBTOTAL_KEYS = [
  'line_total',
  'line_item_total',
  'line_amount',
  'line_item_amount',
  'subtotal',
  'line_subtotal',
  'total_price',
  'item_total',
  /** `archieved_order_items` snapshots often store the line bill as `total_amount` */
  'total_amount',
  'amount',
  'snapshot_line_total',
  'final_amount',
];

const UNIT_KEYS = ['unit_price', 'unit_amount', 'price', 'item_price', 'rate'];

/**
 * Best-effort line subtotal from a row (+ optional `items` embed for catalog price).
 */
export function getLineSubtotalFromRow(oi) {
  if (!oi) return 0;
  for (const k of LINE_SUBTOTAL_KEYS) {
    const t = num(oi?.[k]);
    // Skip misleading zeros so a real value (e.g. `total_amount` on archive rows) can win
    if (t != null && t >= 0.01) return t;
  }
  const qty = Number(oi?.quantity ?? 1) || 1;
  for (const k of UNIT_KEYS) {
    const u = num(oi?.[k]);
    if (u != null) return u * qty;
  }
  const ip = num(oi?.items?.price);
  if (ip != null) return ip * qty;
  return 0;
}

/**
 * @returns {number|undefined} unit price for UI / resolveItemTotal
 */
export function getUnitPriceForRow(oi) {
  if (!oi) return undefined;
  for (const k of UNIT_KEYS) {
    const u = num(oi?.[k]);
    if (u != null) return u;
  }
  const ip = num(oi?.items?.price);
  if (ip != null) return ip;
  return undefined;
}

/**
 * Bill header total: prefer `orders.total_amount` when it is present and at least
 * covers the line sum (includes takeaway / fees). Falling back to line-only sum
 * caused delivered takeaway totals to flicker between food-only and grand total.
 */
export function resolveOrderHeaderTotalFromRows(orderRow, rows) {
  const lineSum = (rows || []).reduce((s, oi) => s + getLineSubtotalFromRow(oi), 0);
  const raw = orderRow?.total_amount;
  const pt = raw != null && raw !== '' ? Number(raw) : NaN;
  const headerOk = Number.isFinite(pt) && pt > 0;

  if (headerOk && (lineSum < 0.01 || pt + 0.009 >= lineSum)) {
    return Number(pt.toFixed(2));
  }
  if (lineSum >= 0.01) {
    return Number(lineSum.toFixed(2));
  }
  if (headerOk) {
    return Number(pt.toFixed(2));
  }
  return Number(Math.max(0, lineSum).toFixed(2));
}

/** FK for reorder / cart: column or embedded `items` row. */
export function getLineItemIdFromRow(oi) {
  if (!oi) return null;
  if (oi.item_id != null) return oi.item_id;
  if (oi?.items?.id != null) return oi.items.id;
  return null;
}
