import { supabase } from './supabase';

/**
 * Fetches active payment gateways from public.payment_gateways table.
 * Strictly requires enabled = true AND user_selectable = true.
 * Returns { success, data, error } (NO silent fallback).
 */
export async function fetchActivePaymentGateways() {
  try {
    const { data, error } = await supabase
      .from('payment_gateways')
      .select('code, display_name, supported_methods, is_default, user_selectable, sort_order')
      .eq('enabled', true)
      .eq('user_selectable', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[paymentGatewaysApi] DB error fetching gateways:', error);
      return { success: false, data: null, error: error.message };
    }

    return { success: true, data: data || [], error: null };
  } catch (err) {
    console.error('[paymentGatewaysApi] Network exception fetching gateways:', err);
    return { success: false, data: null, error: err.message };
  }
}
