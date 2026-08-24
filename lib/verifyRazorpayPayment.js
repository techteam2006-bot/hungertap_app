import { CONFIG } from '../config';
import { toAlertMessage } from './toAlertMessage';

/**
 * Fast-path: verify Razorpay Standard Checkout signature via Edge Function.
 * Webhook remains authoritative; this only accelerates settlement after SDK success.
 *
 * @param {{
 *   accessToken: string,
 *   orderId: string,
 *   paymentId?: string | null,
 *   razorpayOrderId: string,
 *   razorpayPaymentId: string,
 *   razorpaySignature: string,
 * }} args
 */
export async function postVerifyRazorpayPayment(args) {
  const url = CONFIG.VERIFY_RAZORPAY_PAYMENT_URL;
  if (!url) {
    return { ok: false, error: 'Payment verification is not configured.', status: 0, data: null };
  }
  if (!args?.accessToken) {
    return { ok: false, error: 'Sign in required.', status: 0, data: null };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.accessToken}`,
        ...(CONFIG.SUPABASE_ANON_KEY ? { apikey: CONFIG.SUPABASE_ANON_KEY } : {}),
      },
      body: JSON.stringify({
        order_id: args.orderId,
        payment_id: args.paymentId || undefined,
        razorpay_order_id: args.razorpayOrderId,
        razorpay_payment_id: args.razorpayPaymentId,
        razorpay_signature: args.razorpaySignature,
      }),
    });

    let data = null;
    try {
      const text = await res.text();
      if (text.trim()) data = JSON.parse(text);
    } catch (_) {
      data = null;
    }

    if (!res.ok || !data?.success) {
      return {
        ok: false,
        error:
          (typeof data?.error === 'string' && data.error) ||
          'Could not verify payment. Waiting for confirmation…',
        status: res.status,
        data,
      };
    }

    return { ok: true, status: res.status, data, action: data?.action };
  } catch (e) {
    return {
      ok: false,
      error: toAlertMessage(e, 'Network error while verifying payment.'),
      status: 0,
      data: null,
    };
  }
}
