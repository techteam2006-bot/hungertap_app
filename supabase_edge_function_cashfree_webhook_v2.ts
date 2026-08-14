/// @ts-nocheck
// Supabase Edge Function (Deno runtime) — not checked by the Expo/React Native tsconfig.

/**
 * cashfree-webhook-v2 — PRODUCTION
 *
 * This is the deployed handler restored, with two changes only:
 *
 *  1. Events on a non-configured webhook version are ACKNOWLEDGED with 200
 *     instead of rejected with 400. This account has the same URL registered
 *     under 2025-01-01, 2023-08-01 and 2021-09-21, so every event arrives three
 *     times in three formats. Only 2025-01-01 carries x-idempotency-key, so the
 *     older two cannot be de-duplicated and must not be processed — but a 400
 *     made Cashfree retry them for hours. A 200 says "received, nothing to do".
 *
 *  2. The replay window is widened (default 15 min, CASHFREE_WEBHOOK_MAX_AGE_S)
 *     because Cashfree's retry backoff exceeds 5 minutes — the old 300 s window
 *     meant any event that failed once could never succeed on retry. Replay
 *     protection does not depend on this window: claim_webhook_event enforces
 *     exactly-once on x-idempotency-key, which is the real defence.
 *
 *  3. Every rejection response and log line now carries a machine-readable
 *     `reason`, so a failure can be diagnosed from the logs without deploying a
 *     separate debug build.
 *
 * All payment logic — claim/complete idempotency, amount and currency checks,
 * the server-side Cashfree re-verification, and the RPC calls — is unchanged.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-timestamp, x-webhook-signature, x-idempotency-key, x-webhook-version",
};

const SUPPORTED_EVENT_TYPES = new Set([
  "PAYMENT_SUCCESS_WEBHOOK",
  "PAYMENT_FAILED_WEBHOOK",
  "PAYMENT_USER_DROPPED_WEBHOOK",
  "REFUND_STATUS_WEBHOOK",
]);

/** Reject with a reason that shows up in both the log and the response body. */
function reject(reason: string, status: number, detail?: Record<string, unknown>) {
  console.warn(`[Cashfree Webhook] REJECT reason=${reason}${detail ? ` detail=${JSON.stringify(detail)}` : ""}`);
  return new Response(JSON.stringify({ error: "Rejected", reason }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
      console.error(`[Cashfree Webhook] complete_webhook_event RPC failed for ${dbId}:`, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Cashfree Webhook] Exception during complete_webhook_event for ${dbId}:`, err);
    return false;
  }
}

async function verifyCashfreeHmac(
  secret: string,
  timestamp: string,
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
      ["verify"]
    );
    const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    const dataToVerify = enc.encode(timestamp + rawBody);
    return await crypto.subtle.verify("HMAC", key, sigBytes, dataToVerify);
  } catch (e) {
    console.error("[Cashfree Webhook] HMAC calculation exception:", e);
    return false;
  }
}

async function verifyWithCashfreeApi(
  orderId: string,
  cfPaymentId: string,
  clientId: string,
  clientSecret: string,
  isProd: boolean
): Promise<{ valid: boolean; txn?: any; error?: string; retryable?: boolean }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const baseUrl = isProd ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";

    const res = await fetch(`${baseUrl}/orders/${orderId}/payments`, {
      method: "GET",
      headers: {
        "x-client-id": clientId,
        "x-client-secret": clientSecret,
        "x-api-version": "2025-01-01",
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const isRetryable = res.status >= 500 || res.status === 429;
      return { valid: false, retryable: isRetryable, error: `Cashfree GET API returned HTTP ${res.status}` };
    }

    const txns = await res.json();
    if (!Array.isArray(txns)) {
      return { valid: false, retryable: false, error: "Invalid payment list format from Cashfree API" };
    }

    const matchedTxn = txns.find(
      (t: any) =>
        String(t.cf_payment_id) === cfPaymentId &&
        String(t.payment_status || "").toUpperCase() === "SUCCESS"
    );

    if (!matchedTxn) {
      return {
        valid: false,
        retryable: false,
        error: `No matching SUCCESS transaction found in Cashfree API for cf_payment_id ${cfPaymentId}`,
      };
    }

    return { valid: true, txn: matchedTxn, retryable: false };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === "AbortError";
    return {
      valid: false,
      retryable: true,
      error: isTimeout ? "Cashfree API fetch timed out (8s)" : err.message || "Network exception reaching Cashfree API",
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // A browser landing on return_url arrives here as GET (or as a POST with no
  // signature). Answer it plainly instead of emitting a confusing 401.
  if (req.method === "GET") {
    return new Response("Payment received. Return to the HungerTap app.", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  const rawEnv = (Deno.env.get("CASHFREE_ENV") || "").trim().toLowerCase();
  if (rawEnv !== "production" && rawEnv !== "sandbox") {
    console.error("[Cashfree Webhook] CASHFREE_ENV missing or invalid. Must be 'production' or 'sandbox'.");
    return new Response(JSON.stringify({ error: "Server environment configuration missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const isProd = rawEnv === "production";

  // The one version this handler understands. Others are acknowledged, not processed.
  const expectedWebhookVersion = (Deno.env.get("CASHFREE_WEBHOOK_VERSION") || "2025-01-01").trim();

  // Cashfree retries with a backoff longer than 5 minutes; exactly-once is
  // enforced by claim_webhook_event, not by this window.
  const maxAgeSeconds = Number(Deno.env.get("CASHFREE_WEBHOOK_MAX_AGE_S") || "900") || 900;

  const cashfreeClientId = (Deno.env.get("CASHFREE_CLIENT_ID") || "").trim();
  const cashfreeSecret = (Deno.env.get("CASHFREE_CLIENT_SECRET") || "").trim();
  if (!cashfreeClientId || !cashfreeSecret) {
    console.error("[Cashfree Webhook] CASHFREE_CLIENT_ID or CASHFREE_CLIENT_SECRET missing.");
    return new Response(JSON.stringify({ error: "Server credentials unconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const timestamp = (req.headers.get("x-webhook-timestamp") || "").trim();
    const signature = (req.headers.get("x-webhook-signature") || "").trim();
    const webhookVersion = (req.headers.get("x-webhook-version") || "").trim();
    const rawBody = await req.text();

    if (!timestamp || !signature) {
      // Almost always a browser hitting return_url, not a real webhook.
      return reject("missing_signature_or_timestamp", 401, {
        userAgent: req.headers.get("user-agent") || "",
      });
    }

    if (webhookVersion !== expectedWebhookVersion) {
      // A duplicate of an event we already receive on the configured version.
      // 200, not 400 — a rejection just makes Cashfree retry it for hours.
      // Remove the extra registrations in the Cashfree dashboard to stop these.
      console.warn(
        `[Cashfree Webhook] IGNORED duplicate delivery on version "${webhookVersion}" ` +
          `(handler speaks "${expectedWebhookVersion}"). Deregister the older version in the Cashfree dashboard.`
      );
      return new Response(
        JSON.stringify({
          status: "ignored_unsupported_webhook_version",
          received: webhookVersion,
          expected: expectedWebhookVersion,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tsNum = Number(timestamp);
    const nowSec = Math.floor(Date.now() / 1000);
    const tsSec = tsNum > 10000000000 ? Math.floor(tsNum / 1000) : tsNum;
    if (isNaN(tsSec) || Math.abs(nowSec - tsSec) > maxAgeSeconds) {
      return reject("timestamp_outside_window", 401, {
        driftSeconds: nowSec - tsSec,
        maxAgeSeconds,
      });
    }

    const isValidSig = await verifyCashfreeHmac(cashfreeSecret, timestamp, rawBody, signature);
    if (!isValidSig) {
      return reject("hmac_mismatch", 401, { signaturePrefix: signature.slice(0, 12) });
    }

    const providerEventId = (req.headers.get("x-idempotency-key") || "").trim();
    if (!providerEventId) {
      return reject("missing_idempotency_key", 400, {});
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reject("malformed_json", 400, {});
    }

    const eventType = String(payload.type || "").trim();
    if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
      console.warn(`[Cashfree Webhook] Unrecognized event_type: '${eventType}'`);
      return new Response(JSON.stringify({ status: "ignored_unsupported_event_type", event_type: eventType }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = payload.data || {};
    const order = data.order || {};
    const payment = data.payment || {};
    const refund = data.refund || {};

    const gatewayOrderId = String(order.order_id || "").trim();
    const cfPaymentId = String(payment.cf_payment_id || "").trim();
    const cfRefundId = String(refund.cf_refund_id || refund.refund_id || "").trim();
    const paymentStatus = String(payment.payment_status || "").trim().toUpperCase();
    const refundStatus = String(refund.refund_status || "").trim().toUpperCase();

    const { data: claimRes, error: claimErr } = await supabase.rpc("claim_webhook_event", {
      p_gateway: "cashfree",
      p_event_id: providerEventId,
      p_event_type: eventType,
      p_payload: payload,
      p_gateway_version: webhookVersion,
    });

    if (claimErr) {
      console.error("[Cashfree Webhook] Infrastructure claim DB error:", claimErr);
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
        console.warn("[Cashfree Webhook] Event currently in_progress. Returning HTTP 500 to retry.");
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

    // ---- REFUND_STATUS_WEBHOOK ----
    if (eventType === "REFUND_STATUS_WEBHOOK") {
      const rawRefundAmount = refund.refund_amount;
      const refundAmount = Number(rawRefundAmount);

      if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        console.warn(`[Cashfree Webhook] Invalid or non-positive refund_amount: ${rawRefundAmount}`);
        await safeCompleteWebhook(supabase, dbEventId, "failed", "invalid_refund_amount", "business_permanent");
        return new Response(JSON.stringify({ error: "Invalid refund amount parameter" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (refundStatus === "SUCCESS" && cfRefundId) {
        const { data: arRes, error: arErr } = await supabase.rpc("apply_refund_success", {
          p_gateway_name: "cashfree",
          p_gateway_refund_id: cfRefundId,
          p_gateway_response: payload,
          p_verify_amount: refundAmount,
        });

        if (arErr || !arRes?.success) {
          const err = arErr?.message || arRes?.error || "apply_refund_success failed";
          console.error(`[Cashfree Webhook] apply_refund_success failed: ${err}`);
          await safeCompleteWebhook(supabase, dbEventId, "failed", err, "infrastructure_retryable");
          return new Response(JSON.stringify({ error: "Failed to apply refund success" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const completed = await safeCompleteWebhook(supabase, dbEventId, "processed");
      if (!completed) {
        return new Response(JSON.stringify({ error: "Webhook finalization failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ status: "processed_refund_event" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- FAILURE / DROP-OFF ----
    if (
      eventType === "PAYMENT_FAILED_WEBHOOK" ||
      eventType === "PAYMENT_USER_DROPPED_WEBHOOK" ||
      paymentStatus === "FAILED"
    ) {
      if (gatewayOrderId) {
        const { data: paymentRow } = await supabase
          .from("payments")
          .select("id, order_id")
          .eq("gateway_name", "cashfree")
          .eq("gateway_order_id", gatewayOrderId)
          .maybeSingle();

        if (paymentRow) {
          const { data: voidRes, error: voidErr } = await supabase.rpc("void_failed_checkout_order", {
            p_order_id: paymentRow.order_id,
            p_payment_id: paymentRow.id,
            p_reason: `Cashfree webhook event: ${eventType}`,
          });

          if (voidErr || !voidRes?.success) {
            const err = voidErr?.message || voidRes?.error || "void_failed_checkout_order failed";
            console.error(`[Cashfree Webhook] void_failed_checkout_order failed: ${err}`);
            await safeCompleteWebhook(supabase, dbEventId, "failed", err, "infrastructure_retryable");
            return new Response(JSON.stringify({ error: "Failed to process order failure compensation" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } else {
          console.warn(`[Cashfree Webhook] No payments row for gateway_order_id=${gatewayOrderId} (failure event)`);
        }
      }

      const completed = await safeCompleteWebhook(
        supabase,
        dbEventId,
        "processed",
        `Handled failure event: ${eventType}`,
        "business_permanent"
      );
      if (!completed) {
        return new Response(JSON.stringify({ error: "Webhook finalization failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ status: "processed_failure_event" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- SUCCESS ----
    if (eventType === "PAYMENT_SUCCESS_WEBHOOK" && paymentStatus === "SUCCESS") {
      if (!gatewayOrderId || !cfPaymentId) {
        await safeCompleteWebhook(supabase, dbEventId, "failed", "missing_identifiers", "business_permanent");
        return new Response(JSON.stringify({ error: "Missing required order or payment identifiers" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawPaymentAmount = payment.payment_amount;
      if (rawPaymentAmount === undefined || rawPaymentAmount === null || rawPaymentAmount === "") {
        await safeCompleteWebhook(supabase, dbEventId, "failed", "missing_payment_amount", "business_permanent");
        return new Response(JSON.stringify({ error: "Invalid payment amount parameter" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const paymentAmount = Number(rawPaymentAmount);
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        await safeCompleteWebhook(supabase, dbEventId, "failed", "invalid_payment_amount", "business_permanent");
        return new Response(JSON.stringify({ error: "Invalid payment amount parameter" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawPaymentCurrency = payment.payment_currency;
      const paymentCurrency = typeof rawPaymentCurrency === "string" ? rawPaymentCurrency.trim().toUpperCase() : "";
      if (paymentCurrency !== "INR") {
        await safeCompleteWebhook(supabase, dbEventId, "failed", "unsupported_currency", "business_permanent");
        return new Response(JSON.stringify({ error: "Unsupported payment currency" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: paymentRow, error: pErr } = await supabase
        .from("payments")
        .select("id, order_id, amount")
        .eq("gateway_name", "cashfree")
        .eq("gateway_order_id", gatewayOrderId)
        .maybeSingle();

      if (pErr || !paymentRow) {
        console.error(`[Cashfree Webhook] Payment not found for gateway_order_id: ${gatewayOrderId}`);
        await safeCompleteWebhook(supabase, dbEventId, "failed", "payment_not_found", "business_permanent");
        return new Response(JSON.stringify({ error: "Payment record not found" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const dbAmount = Number(paymentRow.amount);
      if (!Number.isFinite(dbAmount) || Math.abs(paymentAmount - dbAmount) > 0.01) {
        const errStr = `Financial parameter mismatch: Received=${paymentAmount}, Expected=${paymentRow.amount}`;
        console.error(`[Cashfree Webhook] ${errStr}`);
        await safeCompleteWebhook(supabase, dbEventId, "failed", errStr, "business_permanent");
        return new Response(JSON.stringify({ error: "Invalid payment parameters" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const apiVerify = await verifyWithCashfreeApi(
        gatewayOrderId,
        cfPaymentId,
        cashfreeClientId,
        cashfreeSecret,
        isProd
      );

      if (!apiVerify.valid) {
        console.error(`[Cashfree Webhook] Server double-check failed: ${apiVerify.error}`);
        if (apiVerify.retryable) {
          return new Response(JSON.stringify({ error: "Cashfree API temporary error" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        await safeCompleteWebhook(supabase, dbEventId, "failed", apiVerify.error, "business_permanent");
        return new Response(JSON.stringify({ error: "Provider payment verification failed" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const matchedTxn = apiVerify.txn;
      const apiPaymentAmount = Number(matchedTxn.payment_amount);
      const apiCurrency = String(matchedTxn.payment_currency || "").trim().toUpperCase();

      if (!Number.isFinite(apiPaymentAmount) || apiCurrency !== "INR" || Math.abs(apiPaymentAmount - dbAmount) > 0.01) {
        const errStr = `Cashfree GET API returned mismatched parameters: Currency=${apiCurrency}, PaymentAmount=${apiPaymentAmount}, Expected=${dbAmount}`;
        console.error(`[Cashfree Webhook] ${errStr}`);
        await safeCompleteWebhook(supabase, dbEventId, "failed", errStr, "business_permanent");
        return new Response(JSON.stringify({ error: "Provider transaction parameter mismatch" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: apsRes, error: apsErr } = await supabase.rpc("apply_payment_success", {
        p_payment_id: paymentRow.id,
        p_order_id: paymentRow.order_id,
        p_gateway_payment_id: cfPaymentId,
        p_gateway_response: payload,
        p_gateway_name: "cashfree",
        p_verify_amount: paymentAmount,
        p_verify_currency: paymentCurrency,
      });

      if (apsErr || !apsRes?.success) {
        const err = apsErr?.message || apsRes?.error || "apply_payment_success failed";
        console.error(`[Cashfree Webhook] apply_payment_success failed: ${err}`);
        await safeCompleteWebhook(supabase, dbEventId, "failed", err, "infrastructure_retryable");
        return new Response(JSON.stringify({ error: "Failed to apply payment success" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const completed = await safeCompleteWebhook(supabase, dbEventId, "processed");
      if (!completed) {
        console.error(`[Cashfree Webhook] Webhook finalization failed for ${dbEventId}. Returning HTTP 500 to force retry.`);
        return new Response(JSON.stringify({ error: "Webhook finalization failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`[Cashfree Webhook] SUCCESS order_id=${paymentRow.order_id} cf_payment_id=${cfPaymentId}`);
      return new Response(JSON.stringify({ status: "success", order_id: paymentRow.order_id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const completed = await safeCompleteWebhook(supabase, dbEventId, "processed");
    if (!completed) {
      return new Response(JSON.stringify({ error: "Webhook finalization failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: "processed_non_payment_event" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[Cashfree Webhook] Unhandled exception:", err);
    return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
