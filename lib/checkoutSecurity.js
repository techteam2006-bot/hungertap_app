/**
 * Client-side checkout guards (defense in depth — server RLS/RPC is authoritative).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Hostnames allowed to load in the payment WebView (Easebuzz + Supabase Edge redirects). */
const CHECKOUT_HOST_SUFFIXES = [
  'easebuzz.in',
  'easebuzz.com',
  'cashfree.com',
  'cashfree.in',
  'supabase.co',
];

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedCheckoutUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'https:') {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && proto === 'http:') {
      return true;
    }
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return CHECKOUT_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

/**
 * @param {string} orderId
 * @returns {boolean}
 */
export function isValidOrderUuid(orderId) {
  return UUID_RE.test(String(orderId || '').trim());
}

/** Fields clients must never send on create-order (identity/pricing owned by server). */
export const FORBIDDEN_CHECKOUT_BODY_KEYS = [
  'email',
  'phone',
  'mail',
  'phn',
  'mobile',
  'mobile_no',
  'phone_number',
  'firstname',
  'first_name',
  'name',
  'full_name',
  'user_id',
  'placed_by',
  'role',
  'canteen_id',
  'college_id',
  'total',
  'total_amount',
  'amount',
  'price',
  'unit_price',
  'discount',
  'status',
  'payment_id',
  'order_id',
];

/**
 * @param {Record<string, unknown>} args
 * @returns {string[]} stripped key names (for dev warnings)
 */
export function findForbiddenCheckoutKeys(args) {
  if (!args || typeof args !== 'object') return [];
  return FORBIDDEN_CHECKOUT_BODY_KEYS.filter(
    (k) => args[k] != null && String(args[k]).trim() !== ''
  );
}
