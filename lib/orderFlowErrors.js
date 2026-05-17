/** Short, actionable copy for order flow — avoid mapping every failure to “no canteen”. */

export const MSG_POOR_NETWORK = 'Poor network!';
export const MSG_PAYMENT_FAILED = 'Payment failed';
export const MSG_COULD_NOT_FETCH_DATA = "Couldn't fetch the data!";

/** User row exists but no canteen — only when lookup succeeded and id is missing. */
export const MSG_NO_CANTEEN_ASSIGNED = 'Your profile has no canteen assigned.';

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
