/// @ts-nocheck
// Supabase Edge Function (Deno runtime) — not checked by the Expo/React Native tsconfig.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// SHA-512 Hash helper for Easebuzz
async function sha512(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-512", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Sanitize RPC database errors for user display
function sanitizeRpcError(rawMsg?: string): string {
  if (!rawMsg) return "Failed to process cart items";
  const lower = rawMsg.toLowerCase();
  if (lower.includes("out of stock") || lower.includes("insufficient_stock")) {
    return "Some items in your cart are out of stock";
  }
  if (lower.includes("item_unavailable")) {
    return "Some items in your cart are currently unavailable";
  }
  if (lower.includes("mixed_canteen")) {
    return "Cart items must belong to a single canteen";
  }
  if (lower.includes("invalid_item_quantity")) {
    return "Invalid quantity specified for cart items";
  }
  return rawMsg;
}

/** Roll back a pending checkout when the payment gateway session cannot be created. */
async function voidFailedCheckout(
  supabaseAdmin: ReturnType<typeof createClient>,
  orderId: string,
  paymentId: string | null | undefined,
  reason: string
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc("void_failed_checkout_order", {
      p_order_id: orderId,
      p_payment_id: paymentId || null,
      p_reason: reason,
    });
    if (error) {
      console.error("[create-order-v2-app] void_failed_checkout_order failed:", error, { orderId, paymentId, reason });
    }
  } catch (err) {
    console.error("[create-order-v2-app] void_failed_checkout_order exception:", err, { orderId, paymentId, reason });
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

    // 1. Authenticate user from Auth Header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Client for auth check
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseUserClient.auth.getUser();

    if (userErr || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized user session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Parse request body
    const body = await req.json();
    const { items, is_takeaway = false, gateway_code = "cashfree" } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Cart is empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Admin client to call database RPC safely
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Call Database RPC create_order_v2_app
    const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc("create_order_v2_app", {
      p_gateway_code: gateway_code,
      p_is_takeaway: Boolean(is_takeaway),
      p_items: items,
      p_placed_by: user.id,
    });

    if (rpcErr) {
      console.error("[create-order-v2-app] RPC Error:", rpcErr);
      return new Response(
        JSON.stringify({ success: false, error: sanitizeRpcError(rpcErr.message) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rpcRes || !rpcRes.success) {
      return new Response(
        JSON.stringify({ success: false, error: rpcRes?.error || "Order creation failed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { order_id, total_amount, canteen_id, payment_id } = rpcRes;
    const finalGateway = (gateway_code || "cashfree").toLowerCase();

    // =========================================================================
    // 4A. CASHFREE GATEWAY FLOW
    // =========================================================================
    if (finalGateway === "cashfree") {
      const clientId = Deno.env.get("CASHFREE_CLIENT_ID") || Deno.env.get("CASHFREE_APP_ID");
      const clientSecret = Deno.env.get("CASHFREE_CLIENT_SECRET") || Deno.env.get("CASHFREE_SECRET_KEY");
      const env = (Deno.env.get("CASHFREE_ENV") || "sandbox").toLowerCase();

      if (!clientId || !clientSecret) {
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Cashfree keys not configured");
        return new Response(
          JSON.stringify({ success: false, error: "Gateway 'cashfree' is not configured (missing keys)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const isProduction = env === "production" || env === "prod";
      const cashfreeUrl = isProduction
        ? "https://api.cashfree.com/pg/orders"
        : "https://sandbox.cashfree.com/pg/orders";

      // cashfree-webhook-v2 resolves the payment by (gateway_name, gateway_order_id).
      // create_order_v2_app does not set it, so stamp it here — before the gateway
      // call, so a fast webhook can never arrive ahead of the write. We send our own
      // order id as Cashfree's order_id below, so the value is known up front.
      if (!payment_id) {
        console.error("[create-order-v2-app] RPC returned no payment_id for order", order_id);
        await voidFailedCheckout(supabaseAdmin, order_id, null, "Missing payment_id after order creation");
        return new Response(
          JSON.stringify({ success: false, error: "internal_order_error" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: stampErr } = await supabaseAdmin
        .from("payments")
        .update({ gateway_order_id: String(order_id) })
        .eq("id", payment_id);

      if (stampErr) {
        console.error("[create-order-v2-app] Failed to stamp gateway_order_id:", stampErr);
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Failed to stamp gateway_order_id");
        return new Response(
          JSON.stringify({ success: false, error: "internal_order_error" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Expire the Cashfree order on the same schedule expire_stale_payments()
      // uses locally. Without this Cashfree keeps it open for the account default
      // (days) while the local pending_payment row is cancelled within minutes,
      // so a late failure webhook lands on an order that no longer exists.
      // Set CASHFREE_ORDER_TTL_MIN to match that cron's cutoff. Cashfree requires
      // this to be at least 15 minutes out.
      const orderTtlMin = Math.max(15, Number(Deno.env.get("CASHFREE_ORDER_TTL_MIN") || "20") || 20);
      const orderExpiryTime = new Date(Date.now() + orderTtlMin * 60 * 1000).toISOString();

      // user.phone is only populated for phone-auth accounts; these are email
      // signups, so it is always empty and every order so far went out as
      // 9999999999. UPI *collect* sends the request to this number — a
      // placeholder produces a collect nobody can approve, which is what the
      // "U69::Expired" event in webhook_events is.
      const rawPhone = String(
        user.phone ||
          user.user_metadata?.phone ||
          user.user_metadata?.phone_number ||
          user.user_metadata?.mobile ||
          ""
      ).replace(/[^0-9]/g, "");
      const customerPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : "9999999999";
      if (customerPhone === "9999999999") {
        console.warn(
          `[create-order-v2-app] No real phone for user ${user.id} — UPI collect cannot reach the payer. order_id=${order_id}`
        );
      }

      const customerName =
        String(user.user_metadata?.full_name || user.user_metadata?.name || "").trim().slice(0, 100) ||
        "HungerTap Customer";

      const cashfreeBody = {
        order_id: String(order_id),
        order_amount: Number(total_amount),
        order_currency: "INR",
        order_expiry_time: orderExpiryTime,
        customer_details: {
          customer_id: user.id,
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_email: user.email || "customer@hungertap.com",
        },
        order_meta: {
          // return_url deliberately omitted.
          //
          // Both checkout paths are SDK-driven and neither survives a browser
          // redirect. The WebView fallback runs
          //   Cashfree().checkout({ redirectTarget: "_self" })
          // (PaymentProcessingScreen.js:136), so a return_url navigates the live
          // checkout view away the moment Cashfree considers the session done —
          // to this project's own webhook, whose GET handler serves plain text.
          // On a UPI handoff to PhonePe/GPay that can fire before the payer has
          // authenticated, and Cashfree records it as
          // "User dropped and did not complete the two factor authentication".
          //
          // The native path reports completion through
          // CFPaymentGatewayService.setCallback onVerify/onError
          // (lib/cashfreeCheckout.js:98). notify_url is unaffected.
          notify_url: `${supabaseUrl}/functions/v1/cashfree-webhook-v2`,
        },
      };

      const cfRes = await fetch(cashfreeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-client-id": clientId,
          "x-client-secret": clientSecret,
          "x-api-version": "2025-01-01",
        },
        body: JSON.stringify(cashfreeBody),
      });

      const cfData = await cfRes.json();

      if (!cfRes.ok) {
        // Log the full Cashfree error body and the request shape. cfData.message
        // alone usually omits which field was rejected, which is why the 400s in
        // the function log have been unexplained.
        console.error(
          "[create-order-v2-app] Cashfree PG Error:",
          JSON.stringify({
            http: cfRes.status,
            body: cfData,
            sent: { ...cashfreeBody, customer_details: { customer_id: user.id } },
          })
        );
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Cashfree session creation failed");
        return new Response(
          JSON.stringify({ success: false, error: cfData.message || "Failed to create Cashfree session" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cfSessionId = String(cfData.payment_session_id || "").trim();
      if (!cfSessionId) {
        console.error("[create-order-v2-app] Cashfree returned no payment_session_id:", cfData);
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Cashfree returned no payment_session_id");
        return new Response(
          JSON.stringify({ success: false, error: "Cashfree did not return a payment session" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cfPaymentUrl = isProduction
        ? `https://payments.cashfree.com/order/#${cfSessionId}`
        : `https://sandbox.cashfree.com/order/#${cfSessionId}`;

      return new Response(
        JSON.stringify({
          success: true,
          order_id,
          payment_id,
          gateway: "cashfree",
          payment_session_id: cfSessionId,
          payment_url: cfPaymentUrl,
          // Additive: lets the app's native SDK pick its environment without guessing.
          gateway_environment: isProduction ? "PRODUCTION" : "SANDBOX",
          gateway_response: cfData,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // 4B. EASEBUZZ GATEWAY FLOW
    // =========================================================================
    if (finalGateway === "easebuzz") {
      const key = Deno.env.get("EASEBUZZ_KEY") || Deno.env.get("EASEBUZZ_MERCHANT_KEY");
      const salt = Deno.env.get("EASEBUZZ_SALT");
      const env = (Deno.env.get("EASEBUZZ_ENV") || "test").toLowerCase();

      if (!key || !salt) {
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Easebuzz keys not configured");
        return new Response(
          JSON.stringify({ success: false, error: "Gateway 'easebuzz' is not configured (missing key or salt)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const isProduction = env === "prod" || env === "production";
      const easebuzzUrl = isProduction
        ? "https://pay.easebuzz.in/payment/initiateLink"
        : "https://testpay.easebuzz.in/payment/initiateLink";

      // easebuzz-webhook-v2 resolves the payment as `txnid` and the order as
      // `udf1`. Both must be sent, or the webhook rejects the callback with
      // "Missing paymentId/orderId" and the order never leaves pending_payment.
      if (!payment_id) {
        console.error("[create-order-v2-app] RPC returned no payment_id for order", order_id);
        await voidFailedCheckout(supabaseAdmin, order_id, null, "Missing payment_id after order creation");
        return new Response(
          JSON.stringify({ success: false, error: "internal_order_error" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const txnid = String(payment_id).replace(/[^a-zA-Z0-9_-]/g, "");
      const udf1 = String(order_id).replace(/[^a-zA-Z0-9_-]/g, "");
      const amount = Number(total_amount).toFixed(2);
      const productinfo = "HungerTapOrder";
      
      // Easebuzz requires firstname to be strictly alphanumeric with no spaces or special characters
      const rawName = user.user_metadata?.full_name || user.user_metadata?.name || "Customer";
      const firstname = rawName.replace(/[^a-zA-Z0-9]/g, "") || "Customer";
      
      const rawEmail = (user.email || "customer@hungertap.com").trim();
      const email = rawEmail.includes("@") ? rawEmail : "customer@hungertap.com";
      
      // Phone must be exactly 10 digits
      const digitsOnly = (user.phone || "").replace(/[^0-9]/g, "");
      const phone = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : "9999999999";

      const surl = Deno.env.get("EASEBUZZ_PAYMENT_SUCCESS_URL") || `${supabaseUrl}/functions/v1/easebuzz-webhook-v2`;
      const furl = Deno.env.get("EASEBUZZ_PAYMENT_FAILURE_URL") || `${supabaseUrl}/functions/v1/easebuzz-webhook-v2`;

      // udf1 carries the order id; udf2..udf10 stay empty. Kept as one array so
      // the signed hash and the posted form can never drift apart.
      const udfs = [udf1, "", "", "", "", "", "", "", "", ""];

      // Hash Sequence: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5|udf6|udf7|udf8|udf9|udf10|salt
      const hashStr = [key, txnid, amount, productinfo, firstname, email, ...udfs, salt].join("|");
      const hash = await sha512(hashStr);

      const formData = new URLSearchParams();
      formData.append("key", key);
      formData.append("txnid", txnid);
      formData.append("amount", amount);
      formData.append("productinfo", productinfo);
      formData.append("firstname", firstname);
      formData.append("phone", phone);
      formData.append("email", email);
      formData.append("surl", surl);
      formData.append("furl", furl);
      formData.append("hash", hash);
      udfs.forEach((v, i) => formData.append(`udf${i + 1}`, v));

      const ebRes = await fetch(easebuzzUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const ebData = await ebRes.json();

      if (!ebRes.ok || ebData.status !== 1) {
        console.error("[create-order-v2-app] Easebuzz PG Error:", ebData);
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Easebuzz session creation failed");
        return new Response(
          JSON.stringify({ success: false, error: ebData.data || ebData.error_desc || "Failed to initiate Easebuzz payment" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ebData.data contains the Easebuzz access_key token
      const accessKey = ebData.data;
      const paymentUrl = isProduction
        ? `https://pay.easebuzz.in/pay/${accessKey}`
        : `https://testpay.easebuzz.in/pay/${accessKey}`;

      return new Response(
        JSON.stringify({
          success: true,
          order_id,
          payment_id,
          gateway: "easebuzz",
          payment_session_id: accessKey,
          payment_url: paymentUrl,
          // Additive: lets the app's native SDK pick its pay_mode without guessing.
          gateway_environment: isProduction ? "PRODUCTION" : "SANDBOX",
          gateway_response: ebData,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await voidFailedCheckout(
      supabaseAdmin,
      order_id,
      payment_id,
      `Unsupported gateway: ${gateway_code}`
    );
    return new Response(
      JSON.stringify({ success: false, error: `Unsupported gateway: ${gateway_code}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[create-order-v2-app] Server Exception:", err);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});