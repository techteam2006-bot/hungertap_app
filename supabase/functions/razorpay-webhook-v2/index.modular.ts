/// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  safeCompleteWebhook,
  verifyRazorpayHmac,
} from "./helpers.ts";
import { handlePaymentSuccess, handlePaymentFailed } from "./payments.ts";
import {
  handleRefundCreated,
  handleRefundProcessed,
  handleRefundFailed,
} from "./refunds.ts";

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

  const signature = req.headers.get("x-razorpay-signature") || "";
  if (!signature) {
    console.warn("[Razorpay Webhook] Missing x-razorpay-signature header");
    return new Response(JSON.stringify({ error: "Missing signature header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
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
        status: 500,
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
    if (eventType === "payment.captured" || eventType === "order.paid") {
      return await handlePaymentSuccess(supabase, dbEventId, eventType, payload);
    }
    if (eventType === "payment.failed") {
      return await handlePaymentFailed(supabase, dbEventId, payload);
    }
    if (eventType === "refund.created") {
      return await handleRefundCreated(supabase, dbEventId, payload);
    }
    if (eventType === "refund.processed") {
      return await handleRefundProcessed(supabase, dbEventId, payload);
    }
    if (eventType === "refund.failed") {
      return await handleRefundFailed(supabase, dbEventId, payload);
    }

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
