/// @ts-nocheck
export function normalizePaymentCaptured(payload: any) {
  const p = payload?.payload?.payment?.entity || {};
  return {
    eventId: payload?.event_id || payload?.id,
    gatewayPaymentId: String(p.id || "").trim(),
    gatewayOrderId: String(p.order_id || "").trim(),
    amountPaise: Number(p.amount) || 0,
    currency: String(p.currency || "").trim().toUpperCase(),
    status: String(p.status || "").trim().toLowerCase(),
    notes: p.notes || {},
  };
}

export function normalizeOrderPaid(payload: any) {
  const o = payload?.payload?.order?.entity || {};
  const p = payload?.payload?.payment?.entity || {};
  return {
    eventId: payload?.event_id || payload?.id,
    gatewayPaymentId: String(p.id || "").trim(),
    gatewayOrderId: String(o.id || p.order_id || "").trim(),
    amountPaise: Number(o.amount_paid || o.amount || p.amount) || 0,
    currency: String(o.currency || p.currency || "").trim().toUpperCase(),
    status: String(o.status || "").trim().toLowerCase(),
    notes: o.notes || p.notes || {},
  };
}

export function normalizePaymentFailed(payload: any) {
  const p = payload?.payload?.payment?.entity || {};
  return {
    eventId: payload?.event_id || payload?.id,
    gatewayPaymentId: String(p.id || "").trim(),
    gatewayOrderId: String(p.order_id || "").trim(),
    amountPaise: Number(p.amount) || 0,
    status: "failed",
    notes: p.notes || {},
  };
}

export function normalizeRefundEvent(payload: any) {
  const r = payload?.payload?.refund?.entity || {};
  const p = payload?.payload?.payment?.entity || {};
  return {
    eventId: payload?.event_id || payload?.id,
    gatewayRefundId: String(r.id || "").trim(),
    gatewayPaymentId: String(r.payment_id || p.id || "").trim(),
    amountPaise: Number(r.amount) || 0,
    currency: String(r.currency || "INR").trim().toUpperCase(),
    status: String(r.status || "").trim().toLowerCase(),
    notes: r.notes || {},
  };
}
