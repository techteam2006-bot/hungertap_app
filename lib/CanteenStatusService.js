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

      let query = supabase.from('canteens').select('is_open');

      if (canteenId) {
        query = query.eq('id', canteenId);
      }

      const { data, error } = await query.limit(1).maybeSingle();

      if (error) {
        const net = isNetworkConnectivityFailure(error);
        console.warn('Canteen status check failed:', error.message || error);
        return {
          ok: false,
          errorKind: net ? 'network' : 'fetch',
          error: typeof error.message === 'string' ? error.message : String(error),
        };
      }

      const isOpen = !!data?.is_open;
      return { ok: true, isOpen, errorKind: null, error: null };
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
   * Subscribe to canteen status changes
   * @param {function} callback - Callback function to handle status changes
   * @param {string} canteenId - Optional canteen ID to filter by
   * @returns {object} Subscription object
   */
  subscribeToCanteenStatus(callback, canteenId = null) {
    console.log('🔄 Subscribing to canteen status changes...');

    try {
      const channelName = canteenId
        ? `canteen_status_changes_${String(canteenId).replace(/[^a-zA-Z0-9_-]/g, '_')}`
        : 'canteen_status_changes';

      // Single binding for INSERT+UPDATE (two bindings sometimes doubled CHANNEL_ERROR noise).
      const changesConfig = {
        event: '*',
        schema: 'public',
        table: 'canteens',
      };

      const subscription = supabase
        .channel(channelName)
        .on('postgres_changes', changesConfig, (payload) => {
          const ev = payload.eventType;
          if (ev !== 'INSERT' && ev !== 'UPDATE') return;
          const newStatus = payload.new;
          if (canteenId && newStatus?.id && String(newStatus.id) !== String(canteenId)) {
            return;
          }
          if (!newStatus || typeof callback !== 'function') return;
          console.log('📡 Canteen status changed:', newStatus, `(${ev})`);
          console.log('🏪 Canteen is now:', newStatus.is_open ? 'OPEN' : 'CLOSED');
          try {
            // ✅ crash prevention added
            callback(newStatus);
          } catch (cbErr) {
            console.error('Canteen status subscriber callback:', cbErr);
          }
        })
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ Successfully subscribed to canteen status changes');
          } else if (status === 'CHANNEL_ERROR') {
            const detail =
              err && typeof err === 'object'
                ? JSON.stringify(err)
                : String(err?.message || err || 'unknown');
            console.warn(
              '⚠️ Canteen Realtime channel error (often a brief race on reload/Strict Mode):',
              detail
            );
            console.log(
              '💡 If this repeats: confirm `canteens` is in `supabase_realtime` and SELECT RLS allows your role to read those rows.'
            );
          } else if (status === 'TIMED_OUT') {
            console.warn('⚠️ Canteen status channel subscribe timed out');
          } else if (status === 'CLOSED') {
            console.log('📴 Canteen status channel closed');
          }
        });

      return subscription;
    } catch (error) {
      console.error('❌ Exception in subscribeToCanteenStatus:', error);
      console.log('💡 Enable Realtime on `canteens` or call checkCanteenStatus when needed.');
      return null;
    }
  },
};

export default canteenStatusService;
