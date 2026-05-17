import { CONFIG } from '../config';
import { toAlertMessage } from './toAlertMessage';
import {
  findForbiddenCheckoutKeys,
  isValidOrderUuid,
} from './checkoutSecurity';

/** Turn API error fields (string | object | array) into a readable message for Alerts. */
function normalizeErrorPiece(value, depth = 0) {
  if (value == null || depth > 6) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => normalizeErrorPiece(v, depth + 1)).filter(Boolean).join('. ');
  }
  if (typeof value === 'object') {
    if (typeof value.message === 'string') return value.message.trim();
    if (typeof value.msg === 'string') return value.msg.trim();
    if (typeof value.description === 'string') return value.description.trim();
    if (typeof value.hint === 'string') return value.hint.trim();
    if (typeof value.error === 'string') return value.error.trim();
    if (value.error != null && typeof value.error === 'object') {
      const n = normalizeErrorPiece(value.error, depth + 1);
      if (n) return n;
    }
    try {
      const s = JSON.stringify(value);
      return s === '{}' ? '' : (s.length > 400 ? `${s.slice(0, 400)}…` : s);
    } catch {
      return '';
    }
  }
  return '';
}

export function formatCreateOrderV2Error(data, httpStatus) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return httpStatus ? `Request failed (HTTP ${httpStatus})` : 'Could not start checkout.';
  }
  const parts = [
    normalizeErrorPiece(data.message),
    normalizeErrorPiece(data.error),
    normalizeErrorPiece(data.details),
    normalizeErrorPiece(data.detail),
    normalizeErrorPiece(data.reason),
    normalizeErrorPiece(data.msg),
  ].filter(Boolean);
  let out = parts.length ? [...new Set(parts)].join(' — ') : '';
  if (!out && httpStatus) {
    out = `Request failed (HTTP ${httpStatus})`;
  }
  if (!out) {
    try {
      const s = JSON.stringify(data);
      if (s !== '{}') out = s.length > 320 ? `${s.slice(0, 320)}…` : s;
    } catch (_) {}
  }
  return out || 'Could not start checkout.';
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
    },
  };
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
      error: 'CREATE_ORDER_V2_URL is not configured. Set EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_CREATE_ORDER_V2_URL.',
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
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.accessToken}`,
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
      let errorText = formatCreateOrderV2Error(data, res.status);
      if (
        bodyText.trim() &&
        (!errorText || errorText === 'Could not start checkout.') &&
        (data == null || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0))
      ) {
        errorText = bodyText.trim().slice(0, 800);
      }
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[create-order-v2]', res.status, bodyText?.slice?.(0, 1500) || '');
      }
      return {
        ok: false,
        error: toAlertMessage(errorText, 'Could not start checkout.'),
        status: res.status,
        data,
      };
    }

    return {
      ok: true,
      payment_url: data.payment_url != null ? String(data.payment_url) : '',
      order_id: extractOrderIdFromV2Body(data),
      payment_id: extractPaymentIdFromV2Body(data),
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

/**
 * After a successful create-order-v2 response, open PaymentProcessing with resolved ids.
 */
export async function navigateToPaymentProcessingAfterV2(navigation, supabaseClient, v2, ctx) {
  if (!v2?.ok) {
    return { ok: false, error: v2?.error || 'Could not start checkout.' };
  }
  const paymentUrl = String(v2.payment_url || '').trim();
  if (!paymentUrl) {
    return { ok: false, error: 'No payment page was returned from the server.' };
  }

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
      .in('status', ['pending_payment', 'pending'])
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

  navigation.navigate('PaymentProcessing', {
    paymentUrl,
    orderId,
    paymentId: paymentId || undefined,
    orderItems: [...orderItems],
    orderTotal,
  });
  return { ok: true };
}
