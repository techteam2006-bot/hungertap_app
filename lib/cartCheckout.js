import { supabase, resolveUserCanteenId } from './supabase';
import {
  maxOrderableQtyForItem,
  getLowStockWarningItems,
  formatLowStockWarningMessages,
} from './cartRules';
import {
  isNetworkConnectivityFailure,
  MSG_COULD_NOT_FETCH_DATA,
  MSG_NO_CANTEEN_ASSIGNED,
  MSG_POOR_NETWORK,
} from './orderFlowErrors';

/**
 * Drops lines not in the user's canteen menu and checks quantities vs current stock.
 *
 * @param {string} userId
 * @param {Array<{ id: string, quantity: number, name?: string, available_stock?: unknown }>} cartLines
 * @returns {Promise<{
 *   cartAfterCanteen: typeof cartLines,
 *   removedWrongCanteen: string[],
 *   stockErrors: string[],
 *   stockWarnings: string[],
 * }>}
 */
export async function prepareCheckoutCart(userId, cartLines) {
  const empty = {
    cartAfterCanteen: [],
    removedWrongCanteen: [],
    stockErrors: [],
    stockWarnings: [],
  };

  try {
    // ✅ error handled
    if (!userId || !Array.isArray(cartLines) || cartLines.length === 0) {
      return empty;
    }

    const resolved = await resolveUserCanteenId(userId);
    if (resolved.type === 'NETWORK') {
      return { ...empty, stockErrors: [MSG_POOR_NETWORK] };
    }
    if (resolved.type === 'FETCH') {
      return { ...empty, stockErrors: [MSG_COULD_NOT_FETCH_DATA] };
    }
    if (resolved.type === 'NO_CANTEEN') {
      return { ...empty, stockErrors: [MSG_NO_CANTEEN_ASSIGNED] };
    }
    const canteenId = resolved.canteenId;

    const ids = [...new Set(cartLines.map((c) => c.id).filter(Boolean))];
    const { data, error } = await supabase
      .from('items')
      .select('id, name, available_stock')
      .eq('canteen_id', canteenId)
      .in('id', ids);

    if (error) {
      console.warn('prepareCheckoutCart:', error.message || error);
      return {
        ...empty,
        stockErrors: [isNetworkConnectivityFailure(error) ? MSG_POOR_NETWORK : MSG_COULD_NOT_FETCH_DATA],
      };
    }

    if (!data) {
      console.warn('No data returned');
      return { ...empty, stockErrors: [MSG_COULD_NOT_FETCH_DATA] };
    }

    const byId = new Map((data || []).map((r) => [r.id, r]));
    const removedWrongCanteen = [];
    const cartAfterCanteen = [];

    for (const line of cartLines) {
      const row = byId.get(line.id);
      if (!row) {
        removedWrongCanteen.push(line.name || String(line.id));
        continue;
      }
      cartAfterCanteen.push({
        ...line,
        available_stock: row.available_stock ?? line.available_stock,
      });
    }

    const stockErrors = [];
    for (const line of cartAfterCanteen) {
      const maxQ = maxOrderableQtyForItem(line);
      if (line.quantity > maxQ) {
        stockErrors.push(
          `${line.name || 'Item'}: you have ${line.quantity} but only ${maxQ} can be ordered now.`
        );
      }
    }

    const stockWarnings = formatLowStockWarningMessages(getLowStockWarningItems(cartAfterCanteen));

    return { cartAfterCanteen, removedWrongCanteen, stockErrors, stockWarnings };
  } catch (err) {
    console.warn('prepareCheckoutCart:', err?.message || err);
    if (isNetworkConnectivityFailure(err)) {
      return { ...empty, stockErrors: [MSG_POOR_NETWORK] };
    }
    return { ...empty, stockErrors: [MSG_COULD_NOT_FETCH_DATA] };
  }
}
