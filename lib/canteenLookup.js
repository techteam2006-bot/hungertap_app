import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';

/** If the user pastes a canteen row UUID, resolve by `id`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Load the app’s fixed signup canteen by id — returns live `name` from Supabase.
 * @returns {Promise<{ ok: true, row: object } | { ok: false, reason: string, error?: unknown }>}
 */
export async function fetchFixedSignupCanteen() {
  const id = String(CONFIG.SIGNUP_FIXED_CANTEEN_ID || '').trim();
  if (!id || !UUID_RE.test(id)) {
    return { ok: false, reason: 'not_configured' };
  }
  return lookupCanteenForSignup(id);
}

/**
 * Session-less anon client for signup canteen resolve via RPC only
 * (`lookup_canteen_for_signup`). No direct `canteens` table SELECT.
 */
function getSignupLookupClient() {
  const url = CONFIG.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const key = CONFIG.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  return createClient(url || 'https://invalid.local', key || 'invalid-anon-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * @param {object|null|undefined} row
 */
function normalizeSignupRow(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    name: row.name,
    college_id: row.college_id,
    is_open: row.is_open,
  };
}

/**
 * Resolve canteen during sign-up via SECURITY DEFINER RPC
 * (active + not deleted; at most one row).
 * @param {string} raw
 */
export async function lookupCanteenForSignup(raw) {
  try {
    const trimmed = String(raw || '').trim();
    if (!trimmed) {
      return { ok: false, reason: 'empty' };
    }

    const client = getSignupLookupClient();
    const { data, error } = await client.rpc('lookup_canteen_for_signup', {
      p_query: trimmed,
    });
    if (error) {
      console.error('lookup_canteen_for_signup:', error.message || error);
      return { ok: false, reason: 'fetch', error };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const normalized = normalizeSignupRow(row);
    if (!normalized) return { ok: false, reason: 'not_found' };
    return { ok: true, row: normalized };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { ok: false, reason: 'fetch', error: err };
  }
}
