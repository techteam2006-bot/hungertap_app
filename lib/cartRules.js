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

export function cartLinesSubtotal(lines) {
  return (Array.isArray(lines) ? lines : []).reduce(
    (sum, item) => sum + (Number(item?.price) || 0) * (Number(item?.quantity) || 1),
    0
  );
}

export function isBeverageCartLine(item) {
  const category = String(item?.category || '').toLowerCase();
  const name = String(item?.name || '').toLowerCase();
  return (
    category.includes('beverage') ||
    category.includes('drink') ||
    name.includes('tea') ||
    name.includes('coffee') ||
    name.includes('juice') ||
    name.includes('shake') ||
    name.includes('water') ||
    name.includes('cola') ||
    name.includes('sprite') ||
    name.includes('pepsi') ||
    name.includes('fanta')
  );
}

/**
 * Takeaway charge for cart lines (₹10 × qty of non-beverage items when enabled).
 */
export function takeawayChargeForLines(lines, isTakeaway = false) {
  if (!isTakeaway || !Array.isArray(lines)) return 0;
  const units = lines.reduce((total, item) => {
    if (isBeverageCartLine(item)) return total;
    return total + (Number(item?.quantity) || 1);
  }, 0);
  return units * TAKEAWAY_FEE_PER_ITEM;
}

/** Combined payable total: item subtotal + takeaway (if any). */
export function cartPayableTotal(lines, isTakeaway = false) {
  return cartLinesSubtotal(lines) + takeawayChargeForLines(lines, isTakeaway);
}

export function exceedsMaxOrderTotal(total) {
  const n = Number(total);
  return Number.isFinite(n) && n > CART_MAX_ORDER_TOTAL;
}

/** True when lines (+ optional takeaway) would exceed the ₹2000 cap. */
export function wouldExceedMaxOrderTotal(lines, isTakeaway = false) {
  return exceedsMaxOrderTotal(cartPayableTotal(lines, isTakeaway));
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
 * @param {{ isTakeaway?: boolean }} [options]
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

  if (wouldExceedMaxOrderTotal(nextCart, Boolean(options.isTakeaway))) {
    return { ok: false, error: CART_MAX_ORDER_TOTAL_MESSAGE };
  }

  return { ok: true, addQty };
}

/**
 * @param {Array<{ id: string, quantity: number, name?: string, available_stock?: unknown }>} prevLines
 * @param {string} itemId
 * @param {{ isTakeaway?: boolean }} [options]
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
  if (wouldExceedMaxOrderTotal(nextCart, Boolean(options.isTakeaway))) {
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
