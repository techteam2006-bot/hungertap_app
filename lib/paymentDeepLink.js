/**
 * Parse Easebuzz return URLs (e.g. hungertap://payment-success, myapp://payment-failure).
 * @returns {'success'|'failure'|'cancelled'|null}
 */
export function parsePaymentReturnUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const lower = url.trim().toLowerCase();

  // Explicit cancellation indicators
  if (
    lower.includes('payment-cancel') ||
    lower.includes('payment_cancel') ||
    lower.includes('payment-cancelled') ||
    lower.includes('payment_cancelled') ||
    lower.includes('user_cancel') ||
    lower.includes('usercancel') ||
    lower.includes('txnusercancelled') ||
    lower.includes('order_status=cancelled') ||
    lower.includes('cf_status=cancelled')
  ) {
    return 'cancelled';
  }

  // Explicit failure indicators
  if (
    lower.includes('payment-failure') ||
    lower.includes('payment_failure') ||
    lower.includes('payment-failed') ||
    lower.includes('payment_failed') ||
    lower.includes('txnfailure') ||
    lower.includes('status=failure') ||
    lower.includes('order_status=failed') ||
    lower.includes('cf_status=failed')
  ) {
    return 'failure';
  }

  // Explicit success indicators
  if (
    lower.includes('payment-success') ||
    lower.includes('payment_success') ||
    lower.includes('order_status=success') ||
    lower.includes('order_status=paid') ||
    lower.includes('cf_status=success') ||
    lower.includes('cf_status=paid') ||
    lower.includes('payment_status=success') ||
    lower.includes('txnsuccess') ||
    lower.includes('status=success')
  ) {
    return 'success';
  }

  // Intercept webhook return endpoints without declaring premature outcome
  if (lower.includes('cashfree-webhook') || lower.includes('easebuzz-webhook')) {
    return 'return_to_app';
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
