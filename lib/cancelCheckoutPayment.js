import { isValidOrderUuid } from './checkoutSecurity';

/** JS injected into gateway WebView to abort checkout UI when the user leaves. */
export const GATEWAY_CANCEL_INJECT_JS = `
(function () {
  try {
    var selectors = [
      'a[href*="cancel"]',
      'button[onclick*="cancel"]',
      'input[value*="Cancel" i]',
      'button[name="cancel"]',
      '#btnCancel',
      '.cancel',
      '[data-action="cancel"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        el.click();
        return;
      }
    }
  } catch (e) {}
  try {
    window.location.href = 'hungertap://payment-cancel';
  } catch (e2) {}
})();
true;
`;

/**
 * Nudge the hosted gateway UI toward cancel (WebView only). Native SDK cancel is
 * already handled by the gateway — we do not mutate orders from the client (RLS).
 */
export function triggerGatewayCheckoutCancel(webViewRef) {
  try {
    webViewRef?.current?.injectJavaScript(GATEWAY_CANCEL_INJECT_JS);
  } catch (_) {}
}

/**
 * Client-side pending-payment cancel RPC is intentionally disabled.
 * Finalization is server-owned (webhooks + expire_stale_payments + void via service_role).
 * Kept as a no-op so older call sites do not crash.
 */
export async function cancelOwnPendingPayment() {
  return { ok: false, error: 'disabled' };
}

/**
 * Cancel checkout UI / abandon pending payment.
 *
 * Does not call a client cancel RPC. Nudges the gateway UI (when needed) and
 * briefly polls until the order leaves `pending_payment` (webhook / cron).
 */
export async function abandonCheckoutPayment({
  supabaseClient,
  orderId,
  userId,
  webViewRef,
  fromGateway = false,
} = {}) {
  if (!fromGateway) {
    triggerGatewayCheckoutCancel(webViewRef);
  }
  return waitForCheckoutCancelled({
    supabaseClient,
    orderId,
    userId,
    maxAttempts: 8,
    intervalMs: 400,
  });
}

/**
 * Poll until the order leaves pending_payment after the gateway reports cancel/drop.
 * Cashfree / Easebuzz webhooks call void_failed_checkout_order server-side.
 */
export async function waitForCheckoutCancelled({
  supabaseClient,
  orderId,
  userId,
  maxAttempts = 20,
  intervalMs = 500,
} = {}) {
  if (!supabaseClient || !isValidOrderUuid(orderId) || !userId) return false;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const { data } = await supabaseClient
        .from('orders')
        .select('status')
        .eq('id', orderId)
        .eq('placed_by', userId)
        .maybeSingle();
      const status = String(data?.status || '');
      if (status && status !== 'pending_payment') {
        return true;
      }
    } catch (_) {
      /* retry */
    }
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return false;
}
