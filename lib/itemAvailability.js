/**
 * Menu availability for Home / cart / detail.
 * Prefer explicit `is_available` from get-canteen-menu when present, then `available_stock`.
 * Finite stock (including 0) still gates add-to-cart when stock is tracked.
 */
export function deriveItemIsAvailable(item) {
  if (!item || typeof item !== 'object') return true;

  const rawFlag = item.is_available ?? item.isAvailable;
  if (typeof rawFlag === 'boolean') {
    if (!rawFlag) return false;
  } else if (rawFlag === 'false' || rawFlag === 0 || rawFlag === '0') {
    return false;
  } else if (rawFlag === 'true' || rawFlag === 1 || rawFlag === '1') {
    // continue — still respect stock below
  }

  const rawStock = item.available_stock;
  if (rawStock !== null && rawStock !== undefined) {
    const n = Number(rawStock);
    if (Number.isFinite(n)) {
      return n > 0;
    }
  }

  if (typeof rawFlag === 'boolean') return rawFlag;

  if (item.availability === 'unavailable') return false;
  if (item.availability === 'available') return true;
  return true;
}
