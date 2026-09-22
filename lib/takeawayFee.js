import { supabase, getUserCanteenId } from './supabase';
import { VIEWS } from './supabaseViews';
import { getLastRememberedCanteen, rememberLastCanteen } from './menuCache';
import { resolveTakeawayFeePerItem } from './cartRules';

/**
 * True when a cached fee is safe to show before a live fetch.
 * Rejects legacy `Number(null) === 0` poison written by older app builds.
 */
export function isUsableCachedTakeawayFee(fee) {
  if (fee == null || fee === '') return false;
  const n = Number(fee);
  return Number.isFinite(n) && n > 0;
}

/**
 * Prefer SECURITY DEFINER RPC (avoids canteens RLS / security_invoker grant traps).
 * Fall back to z_active_open_canteens only — never query `canteens` directly
 * (students often get "permission denied for table canteens").
 */
async function readTakeawayChargeFromSupabase(canteenId) {
  const rpcRes = await supabase.rpc('get_student_canteen_takeaway', {
    p_canteen_id: canteenId,
  });
  if (!rpcRes.error) {
    const row = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
    if (row && row.takeaway_charge != null) {
      return {
        feeRaw: row.takeaway_charge,
        name: row.name || '',
      };
    }
  }

  const viewRes = await supabase
    .from(VIEWS.ACTIVE_OPEN_CANTEENS)
    .select('takeaway_charge, name')
    .eq('id', canteenId)
    .maybeSingle();
  if (!viewRes.error && viewRes.data && viewRes.data.takeaway_charge != null) {
    return {
      feeRaw: viewRes.data.takeaway_charge,
      name: viewRes.data.name || '',
    };
  }

  const err = rpcRes.error || viewRes.error;
  if (err) throw err;
  return { feeRaw: null, name: '' };
}

/**
 * Load per-unit takeaway fee from Supabase (with retries).
 * Returns `fee: null` until a real canteen value (or valid cache) is known —
 * never invents ₹10 for the UI.
 *
 * @param {string|null|undefined} userId
 * @param {{ retries?: number }} [opts]
 * @returns {Promise<{ fee: number|null, fromCache: boolean, canteenId: string|null }>}
 */
export async function loadTakeawayFeeForUser(userId, opts = {}) {
  const retries = Math.max(1, Number(opts.retries) || 3);
  const last = await getLastRememberedCanteen();
  const cachedFee = isUsableCachedTakeawayFee(last?.takeawayCharge)
    ? resolveTakeawayFeePerItem(last.takeawayCharge)
    : null;

  let canteenId = null;
  try {
    canteenId = userId ? await getUserCanteenId(userId) : last?.id || null;
  } catch (_) {
    canteenId = last?.id || null;
  }

  if (!canteenId) {
    return { fee: cachedFee, fromCache: true, canteenId: null };
  }

  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const row = await readTakeawayChargeFromSupabase(canteenId);
      if (row.feeRaw != null && row.feeRaw !== '') {
        const fee = resolveTakeawayFeePerItem(row.feeRaw);
        if (fee != null) {
          rememberLastCanteen(canteenId, row.name || last?.name || '', {
            takeawayCharge: fee,
          }).catch(() => {});
          return { fee, fromCache: false, canteenId };
        }
      }
    } catch (e) {
      lastError = e;
    }
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }

  if (__DEV__ && lastError) {
    console.warn(
      'loadTakeawayFeeForUser: no fee yet after retries',
      lastError?.message || lastError
    );
  }

  // Prefer valid cache; otherwise null — UI must not show a fake amount.
  return { fee: cachedFee, fromCache: true, canteenId };
}
