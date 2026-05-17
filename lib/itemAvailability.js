/**
 * Availability when `items.is_available` is removed: use `available_stock`.
 * When `available_stock` is a finite number (including 0), it wins over any demo `availability` field.
 * null/undefined stock = not stock-limited in the UI (treat as in stock).
 */
export function deriveItemIsAvailable(item) {
  if (!item || typeof item !== 'object') return true;

  const rawStock = item.available_stock;
  if (rawStock !== null && rawStock !== undefined) {
    const n = Number(rawStock);
    if (Number.isFinite(n)) {
      return n > 0;
    }
  }

  if (item.availability === 'unavailable') return false;
  if (item.availability === 'available') return true;
  return true;
}
