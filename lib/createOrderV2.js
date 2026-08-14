import { CONFIG } from '../config';
import { toAlertMessage } from './toAlertMessage';
import {
  findForbiddenCheckoutKeys,
  isValidOrderUuid,
} from './checkoutSecurity';
import { getGeneralizedOrderFlowError } from './orderFlowErrors';

/** Maps known checkout HTTP status codes & database rate-limit errors to user-friendly messages. */
function friendlyCheckoutError(data, httpStatus) {
  const generalized = getGeneralizedOrderFlowError(data, httpStatus);
  if (generalized) return generalized;

  if (data && typeof data === 'object') {
    const err = data.error || data.message || data.details;
    if (typeof err === 'string' && err.trim().length > 0) {
      if (err === 'canteen_closed') return 'Canteen is currently closed. Please try again later.';
      if (err === 'app_orders_paused') return 'App orders are paused for this canteen. Please order at the counter.';
      if (err === 'items_missing' || err === 'wrong_canteen_items') return 'Some items in your cart are no longer available for your canteen.';
      if (err === 'items_unavailable_or_out_of_stock') return 'Some items in your cart are out of stock. Please refresh your cart.';
      if (err === 'invalid_total_amount') return 'Invalid order total. Please review your cart.';
      if (err === 'max_order_amount_exceeded') return 'Maximum order amount allowed is ₹2000.';
      if (err === 'selected_gateway_unavailable') return 'The selected payment gateway is currently unavailable.';
      if (err === 'user_has_no_canteen') return 'Your user account is not assigned to any canteen.';
      if (err === 'internal_order_error') return 'Our servers are having trouble right now. Please try again in a moment.';
      return err;
    }
  }

  if (httpStatus === 401 || httpStatus === 403) return 'Your session has expired. Please sign in again.';
  if (httpStatus === 409) return 'Some items in your cart are no longer available. Please review your cart.';
  if (httpStatus === 422) return 'Your order could not be processed. Please check your cart and try again.';
  if (httpStatus >= 500) return 'Our servers are having trouble right now. Please try again in a moment.';
  return 'Could not place your order. Please try again.';
}

export function formatCreateOrderV2Error(data, httpStatus) {
  return friendlyCheckoutError(data, httpStatus);
}

/**
 * Build the create-order-v2 JSON body (allowlisted fields only).
 * @param {object} args
 * @returns {{ body: object, error?: string }}
 */
export function buildCreateOrderV2RequestBody(args) {
  if (!args || typeof args !== 'object') {
    return { body: null, error: 'Invalid checkout request.' };
  }

  const stripped = findForbiddenCheckoutKeys(args);
  if (stripped.length && typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn('[create-order-v2] Ignoring client identity fields:', stripped.join(', '));
  }

  const items = args.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { body: null, error: 'Cart is empty or invalid.' };
  }

  return {
    body: {
      items,
      is_takeaway: !!args.is_takeaway,
      gateway_code: args.gateway_code || 'cashfree',
    },
  };
}

/**
 * The checkout URL is issued by the server — the app never builds one.
 * Only Easebuzz sends one, as the fallback for when its native SDK is unavailable.
 */
export function extractPaymentUrlFromV2Body(body) {
  if (!body || typeof body !== 'object') return '';

  const raw = body.payment_url ?? body.data?.payment_url;
  if (raw == null) return '';

  const url = String(raw).trim();
  return url.startsWith('https://') ? url : '';
}

export function extractOrderIdFromV2Body(body) {
  if (!body || typeof body !== 'object') return null;
  const v = body.order_id ?? body.orderId ?? body.order?.id;
  return v != null ? String(v) : null;
}

export function extractPaymentIdFromV2Body(body) {
  if (!body || typeof body !== 'object') return null;
  const v = body.payment_id ?? body.paymentId ?? body.payment?.id;
  return v != null ? String(v) : null;
}

export function extractPaymentSessionIdFromV2Body(body) {
  if (!body || typeof body !== 'object') return null;
  const v =
    body.payment_session_id ??
    body.paymentSessionId ??
    body.data?.payment_session_id ??
    body.data?.paymentSessionId;
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Which gateway environment the native SDKs should run in. Server-issued;
 * defaults to SANDBOX so an older backend can never push a build into live mode.
 * @returns {'PRODUCTION'|'SANDBOX'}
 */
export function extractEnvironmentFromV2Body(body) {
  if (!body || typeof body !== 'object') return 'SANDBOX';
  // Deliberately NOT named `environment`: older installed builds read that key
  // when picking a Cashfree host, so reusing it would change their behaviour.
  const v = String(body.gateway_environment ?? body.data?.gateway_environment ?? '')
    .trim()
    .toUpperCase();
  return v === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
}

export function extractGatewayFromV2Body(body) {
  if (!body || typeof body !== 'object') return null;
  const v = body.gateway ?? body.gateway_name ?? body.gateway_code ?? body.data?.gateway;
  return v != null ? String(v).toLowerCase().trim() : null;
}

/**
 * @param {object} args
 * @param {string} args.accessToken JWT (Supabase session)
 * @param {Array<{ item_id: string, quantity: number }>} args.items
 * @param {boolean} [args.is_takeaway] — new order only
 */
export async function postCreateOrderV2(args) {
  const url = CONFIG.CREATE_ORDER_V2_URL;
  if (!url) {
    return {
      ok: false,
      error: 'Checkout is not available right now. Please try again later.',
      status: 0,
      data: null,
    };
  }

  const built = buildCreateOrderV2RequestBody(args);
  if (built.error || !built.body) {
    return {
      ok: false,
      error: built.error || 'Invalid checkout request.',
      status: 0,
      data: null,
    };
  }

  const body = built.body;

  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.log('🚀 [Step 2/7] [createOrderV2] Calling Edge Function:', url, 'Gateway:', body.gateway_code);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.accessToken}`,
        ...(CONFIG.SUPABASE_ANON_KEY ? { apikey: CONFIG.SUPABASE_ANON_KEY } : {}),
      },
      body: JSON.stringify(body),
    });

    let data = null;
    let bodyText = '';
    try {
      bodyText = await res.text();
      if (bodyText.trim()) data = JSON.parse(bodyText);
    } catch (_) {
      data = null;
    }

    if (!res.ok || !data?.success) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('❌ [Step 2/7] [create-order-v2] Failed URL:', url, 'STATUS:', res.status, bodyText?.slice?.(0, 1500) || '');
      }
      return {
        ok: false,
        error: formatCreateOrderV2Error(data, res.status),
        status: res.status,
        data,
      };
    }

    const resolvedPaymentUrl = extractPaymentUrlFromV2Body(data);

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.log('✅ [Step 4/7] [createOrderV2] Backend Order Created:', {
        order_id: data.order_id,
        gateway: data.gateway || body.gateway_code,
        payment_session_id: data.payment_session_id,
        environment: extractEnvironmentFromV2Body(data),
        payment_url: resolvedPaymentUrl || '(none — native SDK)',
      });
    }

    return {
      ok: true,
      payment_url: resolvedPaymentUrl,
      order_id: extractOrderIdFromV2Body(data),
      payment_id: extractPaymentIdFromV2Body(data),
      payment_session_id: extractPaymentSessionIdFromV2Body(data),
      gateway: extractGatewayFromV2Body(data) || body.gateway_code,
      gateway_environment: extractEnvironmentFromV2Body(data),
      status: res.status,
      data,
    };
  } catch (e) {
    return {
      ok: false,
      error: toAlertMessage(e, 'Network error. Check your connection and try again.'),
      status: 0,
      data: null,
    };
  }
}

/**
 * After a successful create-order-v2 response, open PaymentProcessing with resolved ids.
 */
export async function navigateToPaymentProcessingAfterV2(navigation, supabaseClient, v2, ctx) {
  if (!v2?.ok) {
    return { ok: false, error: v2?.error || 'Could not start checkout.' };
  }

  const gateway = v2.gateway || extractGatewayFromV2Body(v2.data) || 'cashfree';

  const userId = ctx?.userId != null ? String(ctx.userId) : '';
  let orderId = v2.order_id || extractOrderIdFromV2Body(v2.data);
  if (orderId && !isValidOrderUuid(orderId)) {
    orderId = null;
  }
  if (!orderId && userId && supabaseClient) {
    const { data: row } = await supabaseClient
      .from('orders')
      .select('id')
      .eq('placed_by', userId)
      .in('status', ['pending_payment'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (row?.id) orderId = String(row.id);
  }
  if (orderId && !isValidOrderUuid(orderId)) {
    return { ok: false, error: 'Invalid order reference returned from checkout.' };
  }
  if (!orderId) {
    return {
      ok: false,
      error:
        'Payment may have started but the order id was not returned. Check My Orders or try again.',
    };
  }

  const paymentId = v2.payment_id || extractPaymentIdFromV2Body(v2.data);
  const orderItems = Array.isArray(ctx?.orderItems) ? ctx.orderItems : [];
  const orderTotal = Number(ctx?.orderTotal) || 0;
  const environment = extractEnvironmentFromV2Body(v2.data);
  const paymentSessionId =
    v2.payment_session_id || extractPaymentSessionIdFromV2Body(v2.data) || '';

  if (gateway === 'cashfree') {
    if (!paymentSessionId) {
      return {
        ok: false,
        error: 'Cashfree checkout could not start: payment session was not returned from the server.',
      };
    }

    navigation.navigate('PaymentProcessing', {
      gateway,
      paymentSessionId,
      paymentUrl: v2.payment_url || String(v2.data?.payment_url || '').trim(),
      environment,
      orderId,
      paymentId: paymentId || undefined,
      orderItems: [...orderItems],
      orderTotal,
      isTakeaway: !!ctx?.isTakeaway,
      // Cashfree PG order id matches our order id (see create-order-v2 edge function).
      cashfreeOrderId: orderId,
    });
    return { ok: true };
  }

  // Easebuzz: native SDK takes the access key; the server-issued URL is the
  // WebView fallback for runtimes without the native module.
  const paymentUrl = String(v2.payment_url || extractPaymentUrlFromV2Body(v2.data) || '').trim();
  if (!paymentSessionId && !paymentUrl) {
    return { ok: false, error: 'No payment page was returned from the server.' };
  }

  navigation.navigate('PaymentProcessing', {
    gateway,
    paymentSessionId,
    paymentUrl,
    environment,
    orderId,
    paymentId: paymentId || undefined,
    orderItems: [...orderItems],
    orderTotal,
    isTakeaway: !!ctx?.isTakeaway,
  });
  return { ok: true };
}
