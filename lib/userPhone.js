/**
 * Phone helpers for auth `user_metadata` (no DB schema changes).
 * Edge `create-order-v2` already reads: user.phone | metadata.phone | phone_number | mobile.
 */

const PHONE_META_KEYS = ['phone', 'phone_number', 'mobile'];

/** Digits only, last 10 for IN mobiles. */
export function normalizePhoneDigits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function formatPhoneDisplay(raw) {
  const d = normalizePhoneDigits(raw);
  if (d.length !== 10) return d || '';
  return `${d.slice(0, 5)} ${d.slice(5)}`;
}

export function isValidIndianMobile(raw) {
  const d = normalizePhoneDigits(raw);
  return /^[6-9]\d{9}$/.test(d);
}

/**
 * Resolve phone from auth user (auth.phone or user_metadata).
 * @param {object|null|undefined} user
 * @returns {string} 10-digit string or ''
 */
export function getPhoneFromUser(user) {
  if (!user) return '';
  const fromAuthPhone = normalizePhoneDigits(user.phone);
  if (fromAuthPhone.length === 10) return fromAuthPhone;

  const meta = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  for (const key of PHONE_META_KEYS) {
    const d = normalizePhoneDigits(meta[key]);
    if (d.length === 10) return d;
  }
  return '';
}

/**
 * Persist phone on auth user_metadata (keys align with create-order-v2).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} rawPhone
 * @returns {Promise<{ ok: boolean, phone?: string, user?: object, error?: string }>}
 */
export async function savePhoneToUserMetadata(supabase, rawPhone) {
  const phone = normalizePhoneDigits(rawPhone);
  if (!isValidIndianMobile(phone)) {
    return {
      ok: false,
      error: 'Enter a valid 10-digit mobile number starting with 6–9.',
    };
  }

  try {
    const { data, error } = await supabase.auth.updateUser({
      data: {
        phone,
        phone_number: phone,
        mobile: phone,
      },
    });

    if (error) {
      console.warn('savePhoneToUserMetadata:', error.message || error);
      return { ok: false, error: error.message || 'Could not save phone number.' };
    }

    return { ok: true, phone, user: data?.user || null };
  } catch (e) {
    console.warn('savePhoneToUserMetadata:', e?.message || e);
    return { ok: false, error: e?.message || 'Could not save phone number.' };
  }
}
