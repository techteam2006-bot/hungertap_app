/**
 * Parse menu/catalog unit price from DB or API (number, numeric string, ₹ prefix, etc.).
 * @param {unknown} raw
 * @returns {number}
 */
export function parseItemUnitPrice(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw >= 0 ? raw : 0;
  }
  if (typeof raw === 'string') {
    const normalized = raw
      .trim()
      .replace(/[₹\s]/g, '')
      .replace(/^(?:rs\.?|inr)\s*/i, '')
      .replace(/,(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const parsed = parseFloat(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 0;
}

/**
 * @param {unknown} amount
 * @returns {string}
 */
export function formatItemPrice(amount) {
  const n = parseItemUnitPrice(amount);
  if (Math.abs(n - Math.round(n)) < 0.001) {
    return String(Math.round(n));
  }
  return n.toFixed(2);
}

/**
 * Line total for UI (e.g. add-to-cart button). Uses at least qty 1 when computing display total.
 * @param {unknown} unitPrice
 * @param {number} quantity — cart quantity; 0 means “about to add one”
 * @returns {number}
 */
export function itemLineTotalForDisplay(unitPrice, quantity) {
  const unit = parseItemUnitPrice(unitPrice);
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  return unit * (qty > 0 ? qty : 1);
}

/**
 * Best unit price for an item row (menu or cart line).
 * @param {Record<string, unknown>|null|undefined} item
 * @returns {number}
 */
export function resolveItemUnitPrice(item) {
  if (!item || typeof item !== 'object') return 0;
  return parseItemUnitPrice(
    item.price ?? item.unit_price ?? item.item_price ?? item.selling_price
  );
}
