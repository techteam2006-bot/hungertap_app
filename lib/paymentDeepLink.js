/**
 * Parse Easebuzz return URLs (e.g. hungertap://payment-success, myapp://payment-failure).
 * @returns {'success'|'failure'|'cancelled'|null}
 */
export function parsePaymentReturnUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const lower = url.trim().toLowerCase();
  if (lower.includes('payment-success') || lower.includes('payment_success')) return 'success';
  if (
    lower.includes('payment-cancel') ||
    lower.includes('payment_cancel') ||
    lower.includes('payment-cancelled') ||
    lower.includes('payment_cancelled') ||
    lower.includes('user_cancel') ||
    lower.includes('usercancel')
  ) {
    return 'cancelled';
  }
  if (
    lower.includes('payment-failure') ||
    lower.includes('payment_failure') ||
    lower.includes('payment-failed') ||
    lower.includes('payment_failed')
  ) {
    return 'failure';
  }
  return null;
}

export function isPaymentReturnUrl(url) {
  return parsePaymentReturnUrl(url) != null;
}

export function isHttpCheckoutUrl(url) {
  const u = String(url || '').trim();
  return u.startsWith('https://') || u.startsWith('http://');
}

export { isAllowedCheckoutUrl } from './checkoutSecurity';
