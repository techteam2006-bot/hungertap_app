/// @ts-nocheck
import { corsHeaders, paiseToRupees, safeCompleteWebhook } from "./helpers.ts";
import { normalizePaymentCaptured, normalizeOrderPaid, normalizePaymentFailed } from "./normalizers.ts";

export async function handlePaymentSuccess(
  supabase: any,
  dbEventId: string,
  eventType: string,
  payload: any
): Promise<Response> {
  const normalized = eventType === "payment.captured"
    ? normalizePaymentCaptured(payload)
    : normalizeOrderPaid(payload);

  const { gatewayPaymentId, gatewayOrderId, amountPaise, currency, notes } = normalized;

  if (!gatewayOrderId && !notes?.payment_id) {
    await safeCompleteWebhook(supabase, dbEventId, "failed", "missing_order_identifiers", "business_permanent");
    return new Response(JSON.stringify({ error: "Missing order identifiers" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (currency !== "INR") {
    await safeCompleteWebhook(supabase, dbEventId, "failed", "unsupported_currency", "business_permanent");
    return new Response(JSON.stringify({ error: "Unsupported currency" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const receivedRupees = paiseToRupees(amountPaise);
  if (receivedRupees <= 0) {
    await safeCompleteWebhook(supabase, dbEventId, "failed", "invalid_amount", "business_permanent");
    return new Response(JSON.stringify({ error: "Invalid payment amount" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let paymentRow: any = null;
  if (gatewayOrderId) {
    const { data: pData } = await supabase
      .from("payments")
      .select("id, order_id, amount, gateway_name, gateway_order_id, status")
      .eq("gateway_name", "razorpay")
      .eq("gateway_order_id", gatewayOrderId)
      .maybeSingle();
    paymentRow = pData;
  }

  if (!paymentRow && notes?.payment_id && notes?.order_id) {
    const { data: pNoteData } = await supabase
      .from("payments")
      .select("id, order_id, amount, gateway_name, gateway_order_id, status")
      .eq("id", notes.payment_id)
      .eq("order_id", notes.order_id)
      .eq("gateway_name", "razorpay")
      .maybeSingle();

    if (pNoteData) {
      if (!pNoteData.gateway_order_id && gatewayOrderId) {
        await supabase
          .from("payments")
          .update({ gateway_order_id: gatewayOrderId })
          .eq("id", pNoteData.id);
        pNoteData.gateway_order_id = gatewayOrderId;
      }
      paymentRow = pNoteData;
    }
  }

  if (!paymentRow) {
    console.error(`[Razorpay Webhook] Payment not found for gateway_order_id: ${gatewayOrderId}`);
    await safeCompleteWebhook(supabase, dbEventId, "failed", "payment_not_found", "business_permanent");
    return new Response(JSON.stringify({ error: "Payment record not found" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const dbAmount = Number(paymentRow.amount);
  if (!Number.isFinite(dbAmount) || Math.abs(receivedRupees - dbAmount) > 0.01) {
    const errStr = `Financial mismatch: Received=${receivedRupees}, Expected=${dbAmount}`;
    console.error(`[Razorpay Webhook] ${errStr}`);
    await safeCompleteWebhook(supabase, dbEventId, "failed", errStr, "business_permanent");
    return new Response(JSON.stringify({ error: "Payment amount mismatch" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: apsRes, error: apsErr } = await supabase.rpc("apply_payment_success", {
    p_payment_id: paymentRow.id,
    p_order_id: paymentRow.order_id,
    p_gateway_payment_id: gatewayPaymentId || null,
    p_gateway_response: payload,
    p_gateway_name: "razorpay",
    p_verify_amount: receivedRupees,
    p_verify_currency: "INR",
  });

  if (apsErr || !apsRes?.success) {
    const err = apsErr?.message || apsRes?.error || "apply_payment_success failed";
    console.error(`[Razorpay Webhook] apply_payment_success failed: ${err}`);
    await safeCompleteWebhook(supabase, dbEventId, "failed", err, "infrastructure_retryable");
    return new Response(JSON.stringify({ error: "Failed to apply payment success" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await safeCompleteWebhook(supabase, dbEventId, "processed");
  return new Response(
    JSON.stringify({ status: "success", action: apsRes?.action, order_id: paymentRow.order_id }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

export async function handlePaymentFailed(
  supabase: any,
  dbEventId: string,
  payload: any
): Promise<Response> {
  const normalized = normalizePaymentFailed(payload);
  const { gatewayOrderId, notes } = normalized;

  let paymentRow: any = null;
  if (gatewayOrderId) {
    const { data: pData } = await supabase
      .from("payments")
      .select("id, order_id")
      .eq("gateway_name", "razorpay")
      .eq("gateway_order_id", gatewayOrderId)
      .maybeSingle();
    paymentRow = pData;
  }
  if (!paymentRow && notes?.payment_id && notes?.order_id) {
    const { data: pData } = await supabase
      .from("payments")
      .select("id, order_id")
      .eq("id", notes.payment_id)
      .eq("order_id", notes.order_id)
      .maybeSingle();
    paymentRow = pData;
  }

  if (paymentRow) {
    await supabase.rpc("void_failed_checkout_order", {
      p_order_id: paymentRow.order_id,
      p_payment_id: paymentRow.id,
      p_reason: "Razorpay payment.failed webhook event",
    });
  }

  await safeCompleteWebhook(supabase, dbEventId, "processed", "Handled failure event", "business_permanent");
  return new Response(
    JSON.stringify({ status: "processed_failure_event" }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
