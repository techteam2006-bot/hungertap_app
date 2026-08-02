import { toAlertMessage } from './toAlertMessage';
import { isValidOrderUuid } from './checkoutSecurity';

/**
 * Abandon an in-progress Easebuzz checkout.
 * 1) RPC `cancel_own_pending_payment` when deployed
 * 2) Direct update of caller's `pending_payment` order → `payment_cancelled`
 * 3) Optional Edge `cancel-payment` when EXPO_PUBLIC_CANCEL_PAYMENT_URL is set
 *
 * @param {object} args
 * @param {string} args.accessToken
 * @param {string} args.orderId
 * @param {string} [args.paymentId]
 * @param {string} [args.userId]
 * @param {import('@supabase/supabase-js').SupabaseClient} [args.supabaseClient]
 */
export async function cancelCheckoutPayment(args) {
  const orderId = String(args?.orderId || '').trim();
  const paymentId = args?.paymentId != null ? String(args.paymentId).trim() : '';
  const accessToken = String(args?.accessToken || '').trim();
  const userId = args?.userId != null ? String(args.userId).trim() : '';
  const supabaseClient = args?.supabaseClient || null;

  if (!isValidOrderUuid(orderId)) {
    return { ok: false, error: 'Invalid order reference.' };
  }

  if (supabaseClient) {
    try {
      const { data: rpcData, error: rpcError } = await supabaseClient.rpc(
        'cancel_own_pending_payment',
        { p_order_id: orderId }
      );
      if (!rpcError) {
        return { ok: true, via: 'rpc', data: rpcData };
      }
      // Undefined function → fall through to direct update / edge.
      const missingRpc =
        rpcError?.code === 'PGRST202' ||
        /could not find the function|does not exist/i.test(String(rpcError?.message || ''));
      if (!missingRpc && typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[cancel-payment] rpc:', rpcError.message || rpcError);
      }
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[cancel-payment] rpc throw:', e?.message || e);
      }
    }

    try {
      let q = supabaseClient
        .from('orders')
        .update({ status: 'payment_cancelled' })
        .eq('id', orderId)
        .eq('status', 'pending_payment');
      if (userId) q = q.eq('placed_by', userId);

      const { data, error } = await q.select('id').maybeSingle();
      if (!error && data?.id) {
        return { ok: true, via: 'db' };
      }
      if (error && typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[cancel-payment] db update:', error.message || error);
      }
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[cancel-payment] db throw:', e?.message || e);
      }
    }
  }

  // Only hit Edge when explicitly configured (default path may 404).
  const explicitCancelUrl = String(process.env.EXPO_PUBLIC_CANCEL_PAYMENT_URL || '').trim();
  const cancelUrl = explicitCancelUrl
    ? explicitCancelUrl.replace(/\/$/, '')
    : '';
  if (cancelUrl && accessToken) {
    try {
      const res = await fetch(cancelUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          order_id: orderId,
          ...(paymentId ? { payment_id: paymentId } : {}),
          reason: 'user_back_navigation',
        }),
      });
      let data = null;
      try {
        const text = await res.text();
        if (text.trim()) data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
      if (res.ok && data?.success !== false) {
        return { ok: true, via: 'edge', data };
      }
    } catch (_) {
      /* fall through */
    }
  }

  // Still leave checkout UI even if DB write was blocked — avoid trapping user.
  return {
    ok: false,
    error: toAlertMessage(null, 'Could not cancel payment on the server.'),
  };
}

/** JS injected into Easebuzz WebView to abort checkout UI when the user confirms leave. */
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
