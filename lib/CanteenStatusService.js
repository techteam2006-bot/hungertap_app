// Canteen Status Service
// Handles checking if canteen is open/closed

import { supabase, getUserCanteenId } from './supabase';
import { isNetworkConnectivityFailure } from './orderFlowErrors';

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

      const { data, error } = await supabase
        .from('canteens')
        .select('is_open, app_orders_enabled')
        .eq('id', canteenId)
        .limit(1)
        .maybeSingle();

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
      const isOpen = kitchenOpen && appOrdersEnabled;
      let closureReason = null;
      if (!isOpen) {
        closureReason = !kitchenOpen ? 'kitchen_closed' : 'orders_paused';
      }

      return { ok: true, isOpen, closureReason, errorKind: null, error: null };
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
