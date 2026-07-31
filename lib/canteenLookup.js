import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';

/** If the user pastes a canteen row UUID, resolve by `id`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Session-less anon client for public canteen directory reads during signup.
 * The shared `supabase` client attaches the OTP session; authenticated RLS often
 * scopes `canteens` to the user's college, which does not exist yet → empty rows
 * and a false "Canteen not found". Anon SELECT policies still allow the lookup.
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
 * Resolve canteen during sign-up: full id, then case-insensitive name match.
 * Prefers exact name, then unique prefix, then unique substring.
 * @param {string} raw
 */
export async function lookupCanteenForSignup(raw) {
  try {
    const trimmed = String(raw || '').trim();
    if (!trimmed) {
      return { ok: false, reason: 'empty' };
    }

    const client = getSignupLookupClient();

    if (UUID_RE.test(trimmed)) {
      const { data, error } = await client
        .from('canteens')
        .select('id, college_id, is_open, name')
        .eq('id', trimmed)
        .maybeSingle();
      if (error) {
        console.error('lookupCanteenForSignup:', error.message || error);
        return { ok: false, reason: 'fetch', error };
      }
      if (data) return { ok: true, row: data };
    }

    const safeForLike = trimmed.replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!safeForLike) {
      return { ok: false, reason: 'empty' };
    }

    // Exact name first (avoids "iare" matching both "iare" and "iare1" as ambiguous).
    const { data: exactRows, error: exactErr } = await client
      .from('canteens')
      .select('id, college_id, is_open, name')
      .ilike('name', safeForLike)
      .limit(5);

    if (exactErr) {
      console.error('lookupCanteenForSignup:', exactErr.message || exactErr);
      return { ok: false, reason: 'fetch', error: exactErr };
    }

    if (exactRows?.length === 1) {
      return { ok: true, row: exactRows[0] };
    }
    if (exactRows?.length > 1) {
      const lower = trimmed.toLowerCase();
      const exact = exactRows.find((r) => (r.name || '').trim().toLowerCase() === lower);
      if (exact) return { ok: true, row: exact };
      return { ok: false, reason: 'ambiguous', rows: exactRows };
    }

    const { data: rows, error } = await client
      .from('canteens')
      .select('id, college_id, is_open, name')
      .ilike('name', `%${safeForLike}%`)
      .limit(30);

    if (error) {
      console.error('lookupCanteenForSignup:', error.message || error);
      return { ok: false, reason: 'fetch', error };
    }

    if (!rows?.length) {
      return { ok: false, reason: 'not_found' };
    }

    const lower = trimmed.toLowerCase();
    const exact = rows.find((r) => (r.name || '').trim().toLowerCase() === lower);
    if (exact) return { ok: true, row: exact };

    if (rows.length === 1) {
      return { ok: true, row: rows[0] };
    }

    const prefixOnly = rows.filter((r) =>
      (r.name || '').trim().toLowerCase().startsWith(lower)
    );
    if (prefixOnly.length === 1) {
      return { ok: true, row: prefixOnly[0] };
    }

    return { ok: false, reason: 'ambiguous', rows };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { ok: false, reason: 'fetch', error: err };
  }
}
