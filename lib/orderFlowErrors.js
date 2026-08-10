/** Short, actionable copy for order flow — avoid mapping every failure to “no canteen”. */

export const MSG_POOR_NETWORK = 'Poor network!';
export const MSG_PAYMENT_FAILED = 'Payment failed';
export const MSG_COULD_NOT_FETCH_DATA = "Couldn't fetch the data!";

/** User row exists but no canteen — only when lookup succeeded and id is missing. */
export const MSG_NO_CANTEEN_ASSIGNED = 'Your profile has no canteen assigned.';

/** Generalized user guidance messaging for order flow rate limits and anti-spam backend rules. */
export const MSG_RATE_LIMIT_COOLDOWN = 'Please wait a few seconds before placing another order.';
export const MSG_RATE_LIMIT_HIGH_FREQUENCY = 'You are placing orders too quickly. Please try again shortly.';
export const MSG_RATE_LIMIT_ACTIVE_ORDERS = 'You have reached the limit for active orders. Please wait for your pending orders to complete before placing a new one.';

/**
 * Maps rate limit, cooldown, sliding window, and active order errors to clean, generalized user copy.
 * @param {unknown} error
 * @param {number} [httpStatus]
 * @returns {string | null}
 */
export function getGeneralizedOrderFlowError(error, httpStatus) {
  const errStr = String(
    typeof error === 'object'
      ? error?.message || error?.error || error?.details || JSON.stringify(error)
      : error || ''
  ).toLowerCase();

  if (
    errStr.includes('active order') ||
    errStr.includes('pending order') ||
    errStr.includes('limit for active orders') ||
    errStr.includes('max active') ||
    errStr.includes('active_order_limit')
  ) {
    return MSG_RATE_LIMIT_ACTIVE_ORDERS;
  }

  if (
    errStr.includes('cooldown') ||
    errStr.includes('please wait') ||
    errStr.includes('rapid') ||
    errStr.includes('per-student cooldown')
  ) {
    return MSG_RATE_LIMIT_COOLDOWN;
  }

  if (
    httpStatus === 429 ||
    errStr.includes('too quickly') ||
    errStr.includes('frequency') ||
    errStr.includes('rate limit') ||
    errStr.includes('too many requests') ||
    errStr.includes('sliding window')
  ) {
    return MSG_RATE_LIMIT_HIGH_FREQUENCY;
  }

  return null;
}

/**
 * Offline / transient transport failures (RN fetch TypeError, Supabase-ish messages, timeouts).
 * @param {unknown} error
 * @returns {boolean}
 */
export function isNetworkConnectivityFailure(error) {
  if (error == null) return false;
  if (typeof error !== 'object') {
    const low = String(error).toLowerCase();
    return (
      low.includes('network request failed') ||
      low.includes('failed to fetch') ||
      low.includes('load failed')
    );
  }

  const name = typeof error.name === 'string' ? error.name : '';
  const code = typeof error.code === 'string' ? error.code : '';
  const msg = [
    typeof error.message === 'string' ? error.message : '',
    error.cause && typeof error.cause.message === 'string' ? error.cause.message : '',
    typeof error.details === 'string' ? error.details : '',
    typeof error.hint === 'string' ? error.hint : '',
  ]
    .join(' ')
    .toLowerCase();

  if (name === 'AbortError' || code === 'ABORT_ERR') return true;
  if (name === 'TypeError' && (msg.includes('network request failed') || msg.includes('failed to fetch'))) {
    return true;
  }

  const patterns = [
    'network request failed',
    'failed to fetch',
    'networkerror',
    'network error',
    'net::',
    'load failed',
    'connection refused',
    'connection reset',
    'timed out',
    'timeout',
    'econnrefused',
    'enotfound',
    'eai_again',
    'getaddrinfo',
    'offline',
    'no internet',
    'network aborted',
    'fetch failed',
    'request has been terminated',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
  ];

  for (const p of patterns) {
    if (msg.includes(p)) return true;
  }

  return false;
}
