/// @ts-nocheck
import { paiseToRupees, safeCompleteWebhook, corsHeaders } from "./helpers.ts";
import { normalizeRefundEvent } from "./normalizers.ts";

export async function handleRefundCreated(
  supabase: any,
  dbEventId: string,
  payload: any
): Promise<Response> {
  const normalized = normalizeRefundEvent(payload);
  const { gatewayRefundId, gatewayPaymentId } = normalized;

  if (gatewayPaymentId) {
    const { data: payRow } = await supabase
      .from("payments")
      .select("id")
      .eq("gateway_name", "razorpay")
      .eq("gateway_payment_id", gatewayPaymentId)
      .maybeSingle();

    if (payRow) {
      await supabase
        .from("refunds")
        .update({
          status: "processing",
          gateway_refund_id: gatewayRefundId || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq("payment_id", payRow.id)
        .in("status", ["scheduled", "initiated"]);
    }
  }

  await safeCompleteWebhook(supabase, dbEventId, "processed", "Handled refund.created");
  return new Response(JSON.stringify({ status: "refund_processing" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleRefundProcessed(
  supabase: any,
  dbEventId: string,
  payload: any
): Promise<Response> {
  const normalized = normalizeRefundEvent(payload);
  const { gatewayRefundId, amountPaise } = normalized;
  const refundAmount = paiseToRupees(amountPaise);

  if (gatewayRefundId && refundAmount > 0) {
    const { data: arRes, error: arErr } = await supabase.rpc("apply_refund_success", {
      p_gateway_name: "razorpay",
      p_gateway_refund_id: gatewayRefundId,
      p_gateway_response: payload,
      p_verify_amount: refundAmount,
    });

    if (arErr || !arRes?.success) {
      const err = arErr?.message || arRes?.error || "apply_refund_success failed";
      console.error(`[Razorpay Webhook] apply_refund_success failed: ${err}`);
      await safeCompleteWebhook(supabase, dbEventId, "failed", err, "infrastructure_retryable");
      return new Response(JSON.stringify({ error: "Failed to apply refund success" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  await safeCompleteWebhook(supabase, dbEventId, "processed");
  return new Response(JSON.stringify({ status: "processed_refund_event" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleRefundFailed(
  supabase: any,
  dbEventId: string,
  payload: any
): Promise<Response> {
  const normalized = normalizeRefundEvent(payload);
  const { gatewayRefundId, gatewayPaymentId } = normalized;

  if (gatewayRefundId) {
    await supabase
      .from("refunds")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("gateway_refund_id", gatewayRefundId);
  } else if (gatewayPaymentId) {
    const { data: payRow } = await supabase
      .from("payments")
      .select("id")
      .eq("gateway_name", "razorpay")
      .eq("gateway_payment_id", gatewayPaymentId)
      .maybeSingle();
    if (payRow) {
      await supabase
        .from("refunds")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("payment_id", payRow.id);
    }
  }

  await safeCompleteWebhook(supabase, dbEventId, "processed", "Handled refund.failed");
  return new Response(JSON.stringify({ status: "refund_failed_recorded" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
