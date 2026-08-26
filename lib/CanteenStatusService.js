// Canteen Status Service
// Handles checking if canteen is open/closed

import { supabase, getUserCanteenId } from './supabase';
import { isNetworkConnectivityFailure } from './orderFlowErrors';
import { VIEWS } from './supabaseViews';
import { rememberLastCanteen } from './menuCache';

export const canteenStatusService = {
  /**
   * Check if canteen is currently open (server truth).
   * On failures, `ok` is false — callers must not treat as “closed”; use errorKind instead.
   * @param {string|null} [canteenId]
   * @param {string|null} [userId]
   * @returns {Promise<
   *   | { ok: true, isOpen: boolean, errorKind: null, error: null }
   *   | { ok: false, isOpen?: undefined, errorKind: 'network'|'fetch', error: string }
   * >}
   */
  async checkCanteenStatus(canteenId = null, userId = null) {
    try {
      // If no canteenId provided, try to get user's canteen
      if (!canteenId && userId) {
        canteenId = await getUserCanteenId(userId);
      }

      if (!canteenId) {
        return {
          ok: false,
          errorKind: 'fetch',
          error: 'no_canteen_assigned',
        };
      }

      let data = null;
      let error = null;

      const viewRes = await supabase
        .from(VIEWS.ACTIVE_OPEN_CANTEENS)
        .select('is_open, app_orders_enabled, accepting_app_orders, takeaway_charge')
        .eq('id', canteenId)
        .limit(1)
        .maybeSingle();

      if (!viewRes.error && viewRes.data) {
        data = viewRes.data;
      } else {
        const tableRes = await supabase
          .from('canteens')
          .select('is_open, app_orders_enabled, takeaway_charge')
          .eq('id', canteenId)
          .limit(1)
          .maybeSingle();
        data = tableRes.data;
        error = tableRes.error;
      }

      if (error) {
        const net = isNetworkConnectivityFailure(error);
        console.warn('Canteen status check failed:', error.message || error);
        return {
          ok: false,
          errorKind: net ? 'network' : 'fetch',
          error: typeof error.message === 'string' ? error.message : String(error),
        };
      }

      if (!data) {
        return {
          ok: false,
          errorKind: 'fetch',
          error: 'canteen_not_found',
        };
      }

      const kitchenOpen = data.is_open === true;
      const appOrdersEnabled = data.app_orders_enabled !== false;
      const isOpen =
        typeof data.accepting_app_orders === 'boolean'
          ? data.accepting_app_orders
          : kitchenOpen && appOrdersEnabled;
      let closureReason = null;
      if (!isOpen) {
        closureReason = !kitchenOpen ? 'kitchen_closed' : 'orders_paused';
      }

      // Keep offline cart fee in sync with live canteen row (same idea as name).
      if (data.takeaway_charge != null) {
        rememberLastCanteen(canteenId, '', { takeawayCharge: data.takeaway_charge }).catch(() => {});
      }

      return { ok: true, isOpen, closureReason, errorKind: null, error: null, takeawayCharge: data.takeaway_charge };
    } catch (error) {
      const net = isNetworkConnectivityFailure(error);
      const msg = error?.message ?? String(error);
      console.warn('Exception checking canteen status:', msg);
      return {
        ok: false,
        errorKind: net ? 'network' : 'fetch',
        error: msg,
      };
    }
  },

  /**
   * Update canteen status (for admin use)
   * @param {boolean} isActive - Whether canteen should be active/open
   * @param {string} canteenId - Optional canteen ID. If not provided, updates user's canteen
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async updateCanteenStatus(isActive, canteenId = null, userId = null) {
    try {
      console.log('🔄 Updating canteen status to:', isActive ? 'OPEN' : 'CLOSED');
      
      // If no canteenId provided, try to get user's canteen
      if (!canteenId && userId) {
        canteenId = await getUserCanteenId(userId);
      }
      
      if (!canteenId) {
        return { success: false, error: 'Canteen ID is required' };
      }
      
      const { data, error } = await supabase
        .from('canteens')
        .update({ is_open: isActive })
        .eq('id', canteenId)
        .select()
        .single();

      if (error) {
        console.error('❌ Error updating canteen status:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Canteen status updated successfully');
      return { success: true, error: null };
    } catch (error) {
      console.error('❌ Exception updating canteen status:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Canteen Realtime disabled — poll via checkCanteenStatus / focus refresh instead.
   * Only OrderStatusScreen keeps websocket subscriptions.
   */
  subscribeToCanteenStatus(_callback, _canteenId = null) {
    return null;
  },
};

export default canteenStatusService;
