/** Matches server-side order line limits (create_order_v2 / app policy). */
export const CART_MAX_DISTINCT_ITEMS = 15;
export const CART_MAX_QTY_PER_ITEM = 15;
export const CART_MIN_QTY_PER_ITEM = 1;
/** Max payable total (items + takeaway). Hard gate on cart mutations and checkout. */
export const CART_MAX_ORDER_TOTAL = 2000;
/** Per non-beverage unit when takeaway is enabled. */
export const TAKEAWAY_FEE_PER_ITEM = 10;

export const CART_MAX_ORDER_TOTAL_MESSAGE =
  `Maximum order value is ₹${CART_MAX_ORDER_TOTAL}. Remove some items before adding more.`;

/** Warn when an ordered SKU has fewer than this many units left (chance of cancel after pay). */
export const LOW_STOCK_WARN_THRESHOLD = 10;

/**
 * Items in the cart whose live stock is below {@link LOW_STOCK_WARN_THRESHOLD}
 * but still enough to cover the line quantity.
 *
 * @param {Array<{ id?: string, name?: string, quantity?: number, available_stock?: unknown }>} lines
 * @returns {Array<{ id: string, name: string, quantity: number, available_stock: number }>}
 */
export function getLowStockWarningItems(lines) {
  const out = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const stock = numericAvailableStock(line);
    if (stock === null) continue;
    const qty = Math.max(1, Number(line.quantity) || 1);
    if (stock < qty) continue; // hard OOS is a stockError, not a soft warning
    if (stock < LOW_STOCK_WARN_THRESHOLD) {
      out.push({
        id: String(line.id || ''),
        name: line.name || 'Item',
        quantity: qty,
        available_stock: stock,
      });
    }
  }
  return out;
}

/**
 * Human-readable lines for low-stock confirm / banner.
 * @param {ReturnType<typeof getLowStockWarningItems>} items
 * @returns {string[]}
 */
export function formatLowStockWarningMessages(items) {
  return (Array.isArray(items) ? items : []).map(
    (i) =>
      `${i.name}: only ${i.available_stock} left — this item has a chance of being cancelled if stock runs out.`
  );
}

export function cartLinesSubtotal(lines) {
  return (Array.isArray(lines) ? lines : []).reduce(
    (sum, item) => sum + (Number(item?.price) || 0) * (Number(item?.quantity) || 1),
    0
  );
}

/**
 * Beverage exclusion rule: Filters using backend category metadata (is_beverage flag, category name, categories.name, items join).
 */
export function isBeverageCartLine(item) {
  if (!item) return false;

  // 1. Check explicit backend boolean flag
  if (
    item.is_beverage === true ||
    item.food_items?.is_beverage === true ||
    item.items?.is_beverage === true
  ) {
    return true;
  }

  // 2. Filter using backend category fields (including item.items from DB joins)
  const category = String(
    item?.category ||
      item?.category_name ||
      item?.categories?.name ||
      item?.food_items?.categories?.name ||
      item?.food_items?.category ||
      item?.items?.categories?.name ||
      item?.items?.category ||
      item?.items?.category_name ||
      ''
  ).toLowerCase().trim();

  if (
    category.includes('beverage') ||
    category.includes('drink') ||
    category.includes('juice') ||
    category.includes('shake') ||
    category.includes('tea') ||
    category.includes('coffee') ||
    category.includes('water') ||
    category.includes('cooler') ||
    category.includes('soda')
  ) {
    return true;
  }

  // 3. Fallback name keywords if category metadata is unpopulated
  const name = String(
    item?.name ||
      item?.item_name ||
      item?.title ||
      item?.food_items?.name ||
      item?.items?.name ||
      ''
  ).toLowerCase().trim();

  return (
    name.includes('tea') ||
    name.includes('coffee') ||
    name.includes('juice') ||
    name.includes('shake') ||
    name.includes('water') ||
    name.includes('cola') ||
    name.includes('sprite') ||
    name.includes('pepsi') ||
    name.includes('fanta') ||
    name.includes('drink') ||
    name.includes('beverage') ||
    name.includes('soda') ||
    name.includes('energy')
  );
}

/**
 * Normalize per-unit takeaway fee from canteen row / AsyncStorage (default ₹10).
 * @param {unknown} fee
 */
export function resolveTakeawayFeePerItem(fee) {
  const n = Number(fee);
  if (Number.isFinite(n) && n >= 0) return n;
  return TAKEAWAY_FEE_PER_ITEM;
}

/**
 * Takeaway charge for cart lines (fee × qty of non-beverage items when enabled).
 * Pass canteen `takeaway_charge` when known so cart matches backend create_order.
 * @param {unknown[]} lines
 * @param {boolean} [isTakeaway]
 * @param {number|null|undefined} [feePerItem]
 */
export function takeawayChargeForLines(lines, isTakeaway = false, feePerItem) {
  if (!isTakeaway || !Array.isArray(lines)) return 0;
  const fee = resolveTakeawayFeePerItem(feePerItem);
  const units = lines.reduce((total, item) => {
    if (isBeverageCartLine(item)) return total;
    return total + (Number(item?.quantity) || 1);
  }, 0);
  return units * fee;
}

/** Combined payable total: item subtotal + takeaway (if any). */
export function cartPayableTotal(lines, isTakeaway = false, feePerItem) {
  return cartLinesSubtotal(lines) + takeawayChargeForLines(lines, isTakeaway, feePerItem);
}

export function exceedsMaxOrderTotal(total) {
  const n = Number(total);
  return Number.isFinite(n) && n > CART_MAX_ORDER_TOTAL;
}

/** True when lines (+ optional takeaway) would exceed the ₹2000 cap. */
export function wouldExceedMaxOrderTotal(lines, isTakeaway = false, feePerItem) {
  return exceedsMaxOrderTotal(cartPayableTotal(lines, isTakeaway, feePerItem));
}

export function numericAvailableStock(item) {
  if (!item || item.available_stock === undefined || item.available_stock === null) return null;
  const n = Number(item.available_stock);
  return Number.isFinite(n) ? n : null;
}

/** Max quantity allowed in cart for one SKU: min(15, stock) or 15 if stock untracked. */
export function maxOrderableQtyForItem(item) {
  const s = numericAvailableStock(item);
  if (s === null) return CART_MAX_QTY_PER_ITEM;
  return Math.min(CART_MAX_QTY_PER_ITEM, Math.max(0, s));
}

function clampAddQty(raw) {
  const n = parseInt(String(raw ?? 1), 10);
  if (!Number.isFinite(n) || n < CART_MIN_QTY_PER_ITEM) return CART_MIN_QTY_PER_ITEM;
  return Math.min(CART_MAX_QTY_PER_ITEM, n);
}

/**
 * @param {Array<{ id: string, quantity?: number, name?: string, available_stock?: unknown }>} prevLines
 * @param {{ id: string, name?: string, available_stock?: unknown }} item
 * @param {number} addQtyRaw
 * @param {{ isTakeaway?: boolean, feePerItem?: number }} [options]
 * @returns {{ ok: true, addQty: number } | { ok: false, error: string }}
 */
export function validateAddToCart(prevLines, item, addQtyRaw, options = {}) {
  if (!item?.id) {
    return { ok: false, error: 'Invalid item.' };
  }
  const name = item.name || 'This item';
  const addQty = clampAddQty(addQtyRaw);
  const maxLine = maxOrderableQtyForItem(item);
  if (maxLine < 1) {
    return { ok: false, error: `${name} is out of stock.` };
  }

  const existing = prevLines.find((l) => l.id === item.id);
  const nextQty = (existing ? existing.quantity : 0) + addQty;
  if (nextQty > maxLine) {
    const tracked = numericAvailableStock(item) !== null;
    return {
      ok: false,
      error: tracked
        ? `${name}: only ${maxLine} in stock.`
        : `${name}: you can add at most ${maxLine} of this item.`,
    };
  }

  if (!existing && prevLines.length >= CART_MAX_DISTINCT_ITEMS) {
    return {
      ok: false,
      error: `You can have at most ${CART_MAX_DISTINCT_ITEMS} different items in the cart.`,
    };
  }

  let nextCart;
  if (existing) {
    nextCart = prevLines.map((l) =>
      l.id === item.id ? { ...l, quantity: nextQty } : l
    );
  } else {
    nextCart = [
      ...prevLines,
      {
        ...item,
        quantity: addQty,
        price: Number(item.price) || 0,
      },
    ];
  }

  if (wouldExceedMaxOrderTotal(nextCart, Boolean(options.isTakeaway), options.feePerItem)) {
    return { ok: false, error: CART_MAX_ORDER_TOTAL_MESSAGE };
  }

  return { ok: true, addQty };
}

/**
 * @param {Array<{ id: string, quantity: number, name?: string, available_stock?: unknown }>} prevLines
 * @param {string} itemId
 * @param {{ isTakeaway?: boolean, feePerItem?: number }} [options]
 */
export function validateIncreaseQuantity(prevLines, itemId, options = {}) {
  const line = prevLines.find((l) => l.id === itemId);
  if (!line) return { ok: false, error: 'Item not in cart.' };
  const maxLine = maxOrderableQtyForItem(line);
  if (line.quantity >= maxLine) {
    const tracked = numericAvailableStock(line) !== null;
    return {
      ok: false,
      error: tracked
        ? `Only ${maxLine} in stock for ${line.name || 'this item'}.`
        : `Maximum ${CART_MAX_QTY_PER_ITEM} per item.`,
    };
  }

  const nextCart = prevLines.map((l) =>
    l.id === itemId ? { ...l, quantity: l.quantity + 1 } : l
  );
  if (wouldExceedMaxOrderTotal(nextCart, Boolean(options.isTakeaway), options.feePerItem)) {
    return { ok: false, error: CART_MAX_ORDER_TOTAL_MESSAGE };
  }

  return { ok: true };
}

/**
 * Clamp desired quantity for an existing cart line (1..max for that item).
 */
export function clampQuantityForCartLine(item, desiredQty) {
  const maxLine = Math.max(1, maxOrderableQtyForItem(item));
  let q = parseInt(String(desiredQty ?? 1), 10);
  if (!Number.isFinite(q)) q = CART_MIN_QTY_PER_ITEM;
  q = Math.min(CART_MAX_QTY_PER_ITEM, Math.max(CART_MIN_QTY_PER_ITEM, q));
  return Math.min(q, maxLine);
}
