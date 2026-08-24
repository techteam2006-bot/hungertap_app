/// @ts-nocheck
// Supabase Edge Function (Deno runtime): retry-refund
// Multi-gateway refund processor invoked by notify_refund_edge with { refund_id }.
// Supports razorpay / cashfree / easebuzz. Easebuzz uses live v2 API.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hungertap-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PaymentRow = {
  id: string;
  order_id: string;
  amount: number | string;
  status: string;
  gateway_name?: string | null;
  gateway_payment_id: string | null;
  gateway_order_id?: string | null;
  gateway_response?: Record<string, unknown> | null;
};

type RefundRow = {
  id: string;
  payment_id: string;
  order_id: string;
  amount: number | string;
  status: string;
  retry_count: number | null;
  customer_email: string | null;
  gateway_name?: string | null;
  gateway_refund_id?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha512(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-512", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatEasebuzzAmount(n: number | string): string {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) throw new Error("invalid_refund_amount");
  if (Number.isInteger(num)) return `${num}.0`;
  return num.toFixed(2);
}

function toPaise(amount: number | string): number {
  const str = String(amount).trim();
  const [rupeesStr, paiseStr = "00"] = str.split(".");
  const rupees = parseInt(rupeesStr, 10);
  const paise = parseInt(paiseStr.padEnd(2, "0").slice(0, 2), 10);
  return rupees * 100 + paise;
}

function extractRefundId(body: Record<string, unknown>): string | null {
  if (typeof body.refund_id === "string" && body.refund_id) return body.refund_id;
  if (typeof body.refundId === "string" && body.refundId) return body.refundId;
  const record = body.record as Record<string, unknown> | undefined;
  if (record && typeof record.id === "string") return record.id;
  return null;
}

function resolveEasebuzzId(payment: PaymentRow): string | null {
  const fromCol = payment.gateway_payment_id?.trim();
  if (fromCol) return fromCol;
  const gw = payment.gateway_response;
  if (gw && typeof gw.easepayid === "string" && gw.easepayid.trim()) return gw.easepayid.trim();
  return null;
}

function resolveGateway(refund: RefundRow, payment: PaymentRow): string {
  return String(refund.gateway_name || payment.gateway_name || "")
    .trim()
    .toLowerCase();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const expectedSecret = Deno.env.get("HUNGERTAP_WEBHOOK_SECRET");
    if (!expectedSecret) {
      console.error("HUNGERTAP_WEBHOOK_SECRET is not configured");
      return json({ success: false, error: "server_misconfigured" }, 500);
    }
    const got = req.headers.get("x-hungertap-webhook-secret") || "";
    if (got !== expectedSecret) return json({ success: false, error: "unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const refundId = extractRefundId(body);
    if (!refundId) throw new Error("Missing refund_id");

    let refundSource: "live" | "archived" = "live";
    let { data: refund, error: refundError } = await supabase
      .from("refunds")
      .select("*")
      .eq("id", refundId)
      .maybeSingle();

    if (refundError) throw new Error(refundError.message);
    if (!refund) {
      const archived = await supabase.from("archieved_refunds").select("*").eq("id", refundId).maybeSingle();
      if (archived.error) throw new Error(archived.error.message);
      refund = archived.data;
      refundSource = "archived";
    }

    if (!refund) throw new Error("Refund not found");
    const refundRow = refund as RefundRow;

    if (refundRow.status === "success") {
      return json({ success: true, message: "Already refunded", refund_id: refundId });
    }
    if (refundRow.status === "processing") {
      return json({ success: true, message: "Already in processing", refund_id: refundId });
    }

    const force = body.force === true;
    const retryCount = refundRow.retry_count ?? 0;
    const eligible =
      refundRow.status === "initiated" ||
      (refundRow.status === "failed" && (retryCount < 3 || force));

    if (!eligible) {
      return json({
        success: false,
        error: "not_eligible",
        status: refundRow.status,
        retry_count: retryCount,
      });
    }

    const refundTable = refundSource === "live" ? "refunds" : "archieved_refunds";

    const { data: claimed, error: claimError } = await supabase
      .from(refundTable)
      .update({ status: "processing" })
      .eq("id", refundId)
      .in("status", force ? ["initiated", "failed", "processing"] : ["initiated", "failed"])
      .select("id")
      .maybeSingle();

    if (claimError) throw new Error(claimError.message);
    if (!claimed && !force) {
      return json({ success: true, message: "Claim lost (concurrent worker)", refund_id: refundId });
    }

    let paymentSource: "live" | "archived" = "live";
    let { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("*")
      .eq("id", refundRow.payment_id)
      .maybeSingle();

    if (paymentError) throw new Error(paymentError.message);
    if (!payment) {
      const archivedPay = await supabase
        .from("archieved_payments")
        .select("*")
        .eq("id", refundRow.payment_id)
        .maybeSingle();
      if (archivedPay.error) throw new Error(archivedPay.error.message);
      payment = archivedPay.data;
      paymentSource = "archived";
    }

    if (!payment) {
      await supabase
        .from(refundTable)
        .update({ status: "failed", retry_count: retryCount + 1, failure_reason: "payment_not_found" })
        .eq("id", refundId);
      throw new Error("Payment not found");
    }

    const paymentRow = payment as PaymentRow;
    const gateway = resolveGateway(refundRow, paymentRow);

    let email: string | null = refundRow.customer_email ?? null;
    let placedBy: string | null = null;

    if (!email) {
      const { data: order } = await supabase
        .from("orders")
        .select("placed_by")
        .eq("id", refundRow.order_id)
        .maybeSingle();
      placedBy = order?.placed_by ?? null;
    }
    if (!email && !placedBy) {
      const { data: archived } = await supabase
        .from("archieved_orders")
        .select("placed_by")
        .eq("id", refundRow.order_id)
        .maybeSingle();
      placedBy = archived?.placed_by ?? null;
    }
    if (!email && !placedBy) {
      const { data: failed } = await supabase
        .from("failed_orders")
        .select("placed_by")
        .eq("id", refundRow.order_id)
        .maybeSingle();
      placedBy = failed?.placed_by ?? null;
    }
    if (!email && placedBy) {
      const { data: userData } = await supabase.auth.admin.getUserById(placedBy);
      email = userData?.user?.email ?? null;
    }

    // Easebuzz requires email; Cashfree/Razorpay can proceed without it
    if (!email && gateway === "easebuzz") {
      await supabase
        .from(refundTable)
        .update({
          status: "failed",
          retry_count: retryCount + 1,
          failure_reason: "user_email_not_found",
          customer_email: null,
        })
        .eq("id", refundId);
      throw new Error("User email not found");
    }

    let refundData: Record<string, unknown> = {};
    let gatewayOk = false;
    let failureReason: string | null = null;
    let gatewayRefundId: string | null = null;
    let apiUsed = gateway;

    // -------------------------------------------------------------------------
    // RAZORPAY
    // -------------------------------------------------------------------------
    if (gateway === "razorpay") {
      const razorpayPaymentId = paymentRow.gateway_payment_id?.trim();
      if (!razorpayPaymentId) {
        await supabase
          .from(refundTable)
          .update({
            status: "failed",
            retry_count: retryCount + 1,
            failure_reason: "missing_gateway_payment_id",
          })
          .eq("id", refundId);
        throw new Error("Missing gateway_payment_id for Razorpay refund");
      }

      const keyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
      const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
      if (!keyId || !keySecret) {
        await supabase
          .from(refundTable)
          .update({
            status: "failed",
            retry_count: retryCount + 1,
            failure_reason: "razorpay_keys_missing",
          })
          .eq("id", refundId);
        throw new Error("Razorpay keys not configured");
      }

      const authString = btoa(`${keyId}:${keySecret}`);
      const refundAmountPaise = toPaise(refundRow.amount);
      apiUsed = "razorpay/v1/payments/{id}/refund";

      try {
        // Pre-reconcile existing refund
        const listRes = await fetch(
          `https://api.razorpay.com/v1/payments/${razorpayPaymentId}/refunds`,
          { headers: { Authorization: `Basic ${authString}` } },
        );
        if (listRes.ok) {
          const listData = await listRes.json();
          const existing = listData?.items?.find(
            (r: { notes?: { refund_id?: string }; id?: string; status?: string }) =>
              r.notes?.refund_id === refundRow.id || r.id === refundRow.gateway_refund_id,
          );
          if (existing?.status === "processed") {
            refundData = existing;
            gatewayOk = true;
            gatewayRefundId = existing.id || null;
          }
        }

        if (!gatewayOk) {
          const rzpRes = await fetch(
            `https://api.razorpay.com/v1/payments/${razorpayPaymentId}/refund`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${authString}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                amount: refundAmountPaise,
                speed: "normal",
                notes: { refund_id: refundRow.id, payment_id: refundRow.payment_id },
              }),
            },
          );
          const raw = await rzpRes.text();
          try {
            refundData = JSON.parse(raw);
          } catch {
            refundData = { raw };
          }
          gatewayOk =
            rzpRes.ok &&
            (refundData.status === "processed" ||
              refundData.status === "pending" ||
              refundData.status === "created");
          // Treat pending/created as success for DB (provider accepted); mark success only for processed
          if (rzpRes.ok && refundData.status === "processed") {
            gatewayOk = true;
          } else if (rzpRes.ok && (refundData.status === "pending" || refundData.status === "created")) {
            // Provider accepted — count as success for payment/refund row (live-style success path)
            gatewayOk = true;
          } else {
            gatewayOk = false;
            failureReason = String(
              (refundData.error as Record<string, unknown> | undefined)?.description ||
                refundData.error ||
                `razorpay_status_${refundData.status ?? rzpRes.status}`,
            ).slice(0, 500);
          }
          gatewayRefundId = (refundData.id as string) || null;
        }
      } catch (e) {
        refundData = { error: e instanceof Error ? e.message : String(e) };
        failureReason = `razorpay_request_error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
        gatewayOk = false;
      }
    }

    // -------------------------------------------------------------------------
    // CASHFREE
    // -------------------------------------------------------------------------
    else if (gateway === "cashfree") {
      const clientId = Deno.env.get("CASHFREE_CLIENT_ID") || Deno.env.get("CASHFREE_APP_ID") || "";
      const clientSecret =
        Deno.env.get("CASHFREE_CLIENT_SECRET") || Deno.env.get("CASHFREE_SECRET_KEY") || "";
      if (!clientId || !clientSecret) {
        await supabase
          .from(refundTable)
          .update({
            status: "failed",
            retry_count: retryCount + 1,
            failure_reason: "cashfree_keys_missing",
          })
          .eq("id", refundId);
        throw new Error("Cashfree keys not configured");
      }

      const env = (Deno.env.get("CASHFREE_ENV") || "sandbox").toLowerCase();
      const baseUrl =
        env === "production" || env === "prod"
          ? "https://api.cashfree.com/pg"
          : "https://sandbox.cashfree.com/pg";

      const cfRefundId =
        refundRow.gateway_refund_id ||
        `htrfnd${String(refundRow.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}`;
      const gatewayOrderId = paymentRow.gateway_order_id || String(refundRow.order_id);
      apiUsed = "cashfree/orders/{id}/refunds";

      try {
        const cfRes = await fetch(`${baseUrl}/orders/${gatewayOrderId}/refunds`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-client-id": clientId,
            "x-client-secret": clientSecret,
            "x-api-version": "2025-01-01",
          },
          body: JSON.stringify({
            refund_id: cfRefundId,
            refund_amount: Number(refundRow.amount),
            refund_note: "HungerTap refund",
          }),
        });
        const raw = await cfRes.text();
        try {
          refundData = JSON.parse(raw);
        } catch {
          refundData = { raw };
        }

        const cfStatus = String(refundData.refund_status || refundData.status || "").toUpperCase();
        // SUCCESS / PENDING / ONHOLD = provider accepted
        gatewayOk =
          cfRes.ok &&
          (cfStatus === "SUCCESS" ||
            cfStatus === "PENDING" ||
            cfStatus === "ONHOLD" ||
            cfStatus === "SUCCESS_PENDING");
        if (!gatewayOk) {
          failureReason = String(
            refundData.message ||
              refundData.error ||
              refundData.refund_status ||
              `cashfree_status_${cfRes.status}`,
          ).slice(0, 500);
        }
        gatewayRefundId = cfRefundId;
      } catch (e) {
        refundData = { error: e instanceof Error ? e.message : String(e) };
        failureReason = `cashfree_request_error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
        gatewayOk = false;
      }
    }

    // -------------------------------------------------------------------------
    // EASEBUZZ (live working v2 path)
    // -------------------------------------------------------------------------
    else if (gateway === "easebuzz") {
      const easebuzzId = resolveEasebuzzId(paymentRow);
      if (!easebuzzId) {
        await supabase
          .from(refundTable)
          .update({
            status: "failed",
            retry_count: retryCount + 1,
            failure_reason: "missing_gateway_payment_id",
          })
          .eq("id", refundId);
        throw new Error("Missing easebuzz_id (gateway_payment_id)");
      }

      const envRaw = (Deno.env.get("EASEBUZZ_ENV") || "test").toLowerCase();
      const isProd = envRaw === "production" || envRaw === "prod";
      const DASHBOARD_URL = isProd
        ? "https://dashboard.easebuzz.in"
        : "https://testdashboard.easebuzz.in";

      const key = Deno.env.get("EASEBUZZ_KEY")!;
      const salt = Deno.env.get("EASEBUZZ_SALT")!;
      const merchantRefundId = refundRow.id;
      const refundAmount = formatEasebuzzAmount(refundRow.amount);
      const hashString = `${key}|${merchantRefundId}|${easebuzzId}|${refundAmount}|${salt}`;
      const hash = await sha512(hashString);
      apiUsed = "transaction/v2/refund";

      try {
        const form = new URLSearchParams({
          key,
          easebuzz_id: easebuzzId,
          refund_amount: refundAmount,
          merchant_refund_id: merchantRefundId,
          hash,
        });
        const refundRes = await fetch(`${DASHBOARD_URL}/transaction/v2/refund`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        });
        const raw = await refundRes.text();
        try {
          refundData = JSON.parse(raw);
        } catch {
          refundData = { raw };
        }
        gatewayOk =
          refundData?.status === 1 || refundData?.status === "1" || refundData?.status === true;
        if (!gatewayOk) {
          const nested = refundData?.data as Record<string, unknown> | undefined;
          failureReason = String(
            refundData?.error ||
              refundData?.msg ||
              refundData?.message ||
              nested?.error ||
              nested?.msg ||
              `easebuzz_status_${refundData?.status ?? refundRes.status}`,
          ).slice(0, 500);
        }
        gatewayRefundId =
          (refundData?.refund_id as string) ||
          (refundData?.refund_txn_id as string) ||
          ((refundData?.data as Record<string, unknown> | undefined)?.refund_id as string) ||
          null;
      } catch (e) {
        refundData = { error: e instanceof Error ? e.message : String(e) };
        failureReason = `easebuzz_request_error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
        gatewayOk = false;
      }
    } else {
      await supabase
        .from(refundTable)
        .update({
          status: "failed",
          retry_count: retryCount + 1,
          failure_reason: `unsupported_gateway:${gateway || "empty"}`,
        })
        .eq("id", refundId);
      throw new Error(`Unsupported gateway: ${gateway || "(empty)"}`);
    }

    const nextRetry = gatewayOk ? retryCount : retryCount + 1;

    const refundUpdate: Record<string, unknown> = {
      status: gatewayOk ? "success" : "failed",
      retry_count: nextRetry,
      gateway_response: refundData,
      gateway_refund_id: gatewayRefundId,
      refunded_at: gatewayOk ? new Date().toISOString() : null,
      customer_email: email,
      gateway_name: gateway || null,
    };
    if (refundSource === "live") refundUpdate.failure_reason = gatewayOk ? null : failureReason;

    await supabase.from(refundTable).update(refundUpdate).eq("id", refundId);

    const paymentTable = paymentSource === "live" ? "payments" : "archieved_payments";
    const payAmt = Number(paymentRow.amount);
    const refAmt = Number(refundRow.amount);
    const fullyRefunded =
      gatewayOk && Number.isFinite(payAmt) && Number.isFinite(refAmt) && refAmt >= payAmt - 0.009;
    await supabase
      .from(paymentTable)
      .update({
        status: gatewayOk ? (fullyRefunded ? "refunded" : "refund_pending") : "refund_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentRow.id);

    return json({
      success: true,
      refunded: gatewayOk,
      refund_id: refundId,
      gateway,
      refund_source: refundSource,
      payment_source: paymentSource,
      retry_count: nextRetry,
      failure_reason: gatewayOk ? null : failureReason,
      refund_response: refundData,
      api: apiUsed,
    });
  } catch (e) {
    console.error("[retry-refund]", e);
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
