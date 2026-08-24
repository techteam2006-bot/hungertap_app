/// @ts-nocheck
// Supabase Edge Function (Deno runtime): razorpay-webhook-v2

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature, x-razorpay-event-id",
};

/** Convert paise to standard rupees decimal number (5000 -> 50.00). */
function paiseToRupees(paise: number | string): number {
  const p = Number(paise);
  if (!Number.isFinite(p) || p < 0) return 0;
  return Number((p / 100).toFixed(2));
}

/** Helper to safely finalize webhook status via complete_webhook_event RPC. */
async function safeCompleteWebhook(
  supabase: any,
  dbId: string,
  status: "processed" | "failed",
  errorMsg?: string,
  failureClass?: "infrastructure_retryable" | "business_permanent" | "security_rejection"
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("complete_webhook_event", {
      p_db_id: dbId,
      p_status: status,
      p_error: errorMsg || null,
      p_failure_class: failureClass || null,
    });
    if (error) {
      console.error(`[Razorpay Webhook] complete_webhook_event failed for ${dbId}:`, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Razorpay Webhook] Exception during complete_webhook_event:`, err);
    return false;
  }
}

/** Web Crypto HMAC-SHA256 Verification on raw request body. */
async function verifyRazorpayHmac(
  secret: string,
  rawBody: string,
  signature: string
): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
    const generatedHex = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time string equality check
    if (generatedHex.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < generatedHex.length; i++) {
      mismatch |= generatedHex.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  } catch (e) {
    console.error("[Razorpay Webhook] HMAC calculation exception:", e);
    return false;
  }
}

// Separate Event Normalizers
function normalizePaymentCaptured(payload: any) {
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

function normalizeOrderPaid(payload: any) {
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

function normalizePaymentFailed(payload: any) {
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

function normalizeRefundEvent(payload: any) {
  const r = payload?.payload?.refund?.entity || {};
  const p = payload?.payload?.payment?.entity || {};
  return {
    eventId: payload?.event_id || payload?.id,
    gatewayRefundId: String(r.id || "").trim(),
    gatewayPaymentId: String(r.payment_id || p.id || "").trim(),
    amountPaise: Number(r.amount) || 0,
    currency: String(r.currency || "INR").trim().toUpperCase(),
    status: String(r.status || "").trim().toLowerCase(), // "processed" | "failed"
    notes: r.notes || {},
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");

  if (!webhookSecret) {
    console.error("[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET is not configured.");
    return new Response(JSON.stringify({ error: "Server webhook configuration missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Read Raw Body and Signature Header
  const signature = req.headers.get("x-razorpay-signature") || "";
  if (!signature) {
    console.warn("[Razorpay Webhook] Missing x-razorpay-signature header");
    return new Response(JSON.stringify({ error: "Missing signature header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();

  // 2. Cryptographic HMAC Signature Verification on RAW body
  const isValidSig = await verifyRazorpayHmac(webhookSecret, rawBody, signature);
  if (!isValidSig) {
    console.warn("[Razorpay Webhook] Invalid webhook HMAC signature");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("[Razorpay Webhook] Failed to parse JSON body:", err);
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const eventType = String(payload?.event || "").trim();
  const providerEventId = String(payload?.event_id || payload?.id || req.headers.get("x-razorpay-event-id") || "").trim();

  if (!eventType || !providerEventId) {
    return new Response(JSON.stringify({ error: "Missing event type or event_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // 3. Atomically Claim Webhook Event (Idempotency Lock)
  const { data: claimRes, error: claimErr } = await supabase.rpc("claim_webhook_event", {
    p_gateway: "razorpay",
    p_event_id: providerEventId,
    p_event_type: eventType,
    p_payload: payload,
    p_gateway_version: "v2",
  });

  if (claimErr) {
    console.error("[Razorpay Webhook] claim_webhook_event DB error:", claimErr);
    return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!claimRes?.should_process) {
    if (claimRes?.reason === "already_processed") {
      return new Response(JSON.stringify({ status: "already_processed" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (claimRes?.reason === "in_progress") {
      return new Response(JSON.stringify({ status: "in_progress" }), {
        status: 500, // Return 500 so Razorpay retries later if worker crashed
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ status: "not_processed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const dbEventId = claimRes.db_id;

  try {
    // =========================================================================
    // 4. HANDLE PAYMENT CAPTURED / ORDER PAID (Financial Success Event)
    // =========================================================================
    if (eventType === "payment.captured" || eventType === "order.paid") {
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

      // Step 4A: Gateway-Scoped Payment Lookup
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

      // Step 4B: Strict Notes Fallback Verification
      if (!paymentRow && notes?.payment_id && notes?.order_id) {
        const { data: pNoteData } = await supabase
          .from("payments")
          .select("id, order_id, amount, gateway_name, gateway_order_id, status")
          .eq("id", notes.payment_id)
          .eq("order_id", notes.order_id)
          .eq("gateway_name", "razorpay")
          .maybeSingle();

        if (pNoteData) {
          // Verify relationship and bind gateway_order_id if currently null
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

      // Hard financial check in Edge Function
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

      // Execute Shared apply_payment_success RPC (Database Financial Boundary)
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

    // =========================================================================
    // 5. HANDLE PAYMENT FAILED
    // =========================================================================
    if (eventType === "payment.failed") {
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
        // Monotonic state guard inside void_failed_checkout_order handles locks
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

    // =========================================================================
    // 6. HANDLE REFUND EVENTS
    // =========================================================================
    if (eventType === "refund.created") {
      // Transition refund row to 'processing'
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

    if (eventType === "refund.processed") {
      // Authoritative refund success event
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

    if (eventType === "refund.failed") {
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

    // Default: acknowledge unsupported events
    await safeCompleteWebhook(supabase, dbEventId, "processed", `Ignored event: ${eventType}`);
    return new Response(JSON.stringify({ status: "ignored_event" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[Razorpay Webhook] Unhandled exception:", err);
    await safeCompleteWebhook(supabase, dbEventId, "failed", message, "infrastructure_retryable");
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
