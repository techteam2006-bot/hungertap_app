/// @ts-nocheck
// Supabase Edge Function (Deno runtime): create-order-v2

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Strict monetary amount validation and conversion to integer paise. */
function toPaise(amount: number | string): number {
  const str = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid monetary amount format: "${str}"`);
  }
  const [rupeesStr, paiseStr = "00"] = str.split(".");
  const rupees = parseInt(rupeesStr, 10);
  const paise = parseInt(paiseStr.padEnd(2, "0").slice(0, 2), 10);
  if (!Number.isSafeInteger(rupees) || rupees < 0) {
    throw new Error(`Invalid rupees value: "${rupeesStr}"`);
  }
  const totalPaise = rupees * 100 + paise;
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    throw new Error(`Invalid calculated total paise value: "${totalPaise}"`);
  }
  return totalPaise;
}

/** SHA-512 Hash helper for Easebuzz */
async function sha512(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-512", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Sanitize RPC database errors for user display */
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
  if (lower.includes("selected_gateway_unavailable")) {
    return "The selected payment gateway is currently unavailable";
  }
  if (lower.includes("no_active_default_gateway_configured")) {
    return "No active payment gateway is currently configured";
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
      console.error("[create-order-v2] void_failed_checkout_order failed:", error, { orderId, paymentId, reason });
    }
  } catch (err) {
    console.error("[create-order-v2] void_failed_checkout_order exception:", err, { orderId, paymentId, reason });
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
    const { items, is_takeaway = false, gateway_code = null } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Cart is empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Resolve Target Gateway before RPC to preflight credentials and fail closed without mutating stock
    let targetGatewayCode: string | null = null;
    if (gateway_code && String(gateway_code).trim() !== "") {
      const requested = String(gateway_code).trim().toLowerCase();
      const { data: gwRow } = await supabaseAdmin
        .from("payment_gateways")
        .select("code, enabled, user_selectable")
        .eq("code", requested)
        .maybeSingle();

      if (!gwRow || !gwRow.enabled || !gwRow.user_selectable) {
        return new Response(
          JSON.stringify({ success: false, error: "The selected payment gateway is currently unavailable" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      targetGatewayCode = gwRow.code;
    } else {
      // Fail-closed default gateway resolution
      const { data: defRow } = await supabaseAdmin
        .from("payment_gateways")
        .select("code, enabled, is_default")
        .eq("enabled", true)
        .eq("is_default", true)
        .maybeSingle();

      if (!defRow || !defRow.code) {
        return new Response(
          JSON.stringify({ success: false, error: "No active payment gateway is currently configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      targetGatewayCode = defRow.code;
    }

    // 4. Preflight Gateway Server Credentials (fail early before calling DB order RPC & stock deduction)
    if (targetGatewayCode === "razorpay") {
      const keyId = Deno.env.get("RAZORPAY_KEY_ID");
      const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
      if (!keyId || !keySecret) {
        return new Response(
          JSON.stringify({ success: false, error: "Gateway 'razorpay' is not configured (missing server keys)" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (targetGatewayCode === "cashfree") {
      const clientId = Deno.env.get("CASHFREE_CLIENT_ID") || Deno.env.get("CASHFREE_APP_ID");
      const clientSecret = Deno.env.get("CASHFREE_CLIENT_SECRET") || Deno.env.get("CASHFREE_SECRET_KEY");
      if (!clientId || !clientSecret) {
        return new Response(
          JSON.stringify({ success: false, error: "Gateway 'cashfree' is not configured (missing server keys)" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (targetGatewayCode === "easebuzz") {
      const key = Deno.env.get("EASEBUZZ_KEY") || Deno.env.get("EASEBUZZ_MERCHANT_KEY");
      const salt = Deno.env.get("EASEBUZZ_SALT");
      if (!key || !salt) {
        return new Response(
          JSON.stringify({ success: false, error: "Gateway 'easebuzz' is not configured (missing server keys)" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 5. Call Database RPC create_order_v2_app (passes validated targetGatewayCode)
    const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc("create_order_v2_app", {
      p_gateway_code: targetGatewayCode,
      p_is_takeaway: Boolean(is_takeaway),
      p_items: items,
      p_placed_by: user.id,
    });

    if (rpcErr) {
      console.error("[create-order-v2] RPC Error:", rpcErr);
      return new Response(
        JSON.stringify({ success: false, error: sanitizeRpcError(rpcErr.message) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rpcRes || !rpcRes.success) {
      return new Response(
        JSON.stringify({ success: false, error: sanitizeRpcError(rpcRes?.error || "Order creation failed") }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { order_id, total_amount, payment_id, gateway_code: resolvedGatewayCode } = rpcRes;
    const finalGateway = String(resolvedGatewayCode || "").toLowerCase();

    if (!payment_id) {
      console.error("[create-order-v2] RPC returned no payment_id for order", order_id);
      await voidFailedCheckout(supabaseAdmin, order_id, null, "Missing payment_id after order creation");
      return new Response(
        JSON.stringify({ success: false, error: "internal_order_error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // 5A. RAZORPAY GATEWAY FLOW
    // =========================================================================
    if (finalGateway === "razorpay") {
      const keyId = Deno.env.get("RAZORPAY_KEY_ID");
      const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
      if (!keyId || !keySecret) {
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Razorpay keys not configured on server");
        return new Response(
          JSON.stringify({ success: false, error: "Gateway 'razorpay' is not configured" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let amountInPaise: number;
      try {
        amountInPaise = toPaise(total_amount);
      } catch (err) {
        console.error("[create-order-v2] toPaise calculation error:", err);
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Invalid monetary amount");
        return new Response(
          JSON.stringify({ success: false, error: "Invalid order amount" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const authHeaderRz = "Basic " + btoa(`${keyId}:${keySecret}`);
      const rzRequestBody = {
        amount: amountInPaise,
        currency: "INR",
        receipt: String(order_id),
        notes: {
          order_id: String(order_id),
          payment_id: String(payment_id),
          customer_id: user.id,
        },
      };

      let rzRes: Response;
      let rzData: any = null;
      try {
        rzRes = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: {
            "Authorization": authHeaderRz,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(rzRequestBody),
        });
        rzData = await rzRes.json();
      } catch (fetchErr) {
        // Network timeout / exception reaching Razorpay — Reconcile by receipt before voiding
        console.warn("[create-order-v2] Network exception on Razorpay POST order. Reconciling...", fetchErr);
        try {
          const recRes = await fetch(`https://api.razorpay.com/v1/orders?receipt=${encodeURIComponent(String(order_id))}`, {
            headers: { "Authorization": authHeaderRz },
          });
          if (recRes.ok) {
            const recData = await recRes.json();
            const existingOrder = recData?.items?.find((o: any) => o.receipt === String(order_id));
            if (existingOrder) {
              rzData = existingOrder;
              rzRes = { ok: true, status: 200 } as any;
            }
          }
        } catch (recErr) {
          console.error("[create-order-v2] Razorpay reconciliation also timed out:", recErr);
        }
      }

      if (!rzRes?.ok || !rzData?.id) {
        // Definite 4xx or verified failure
        console.error("[create-order-v2] Razorpay PG creation failed:", rzData);
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Razorpay session creation failed");
        return new Response(
          JSON.stringify({ success: false, error: rzData?.error?.description || "Failed to initiate Razorpay payment" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Stamp payments.gateway_order_id with Razorpay order ID (e.g. 'order_xxxx')
      const { error: stampErr } = await supabaseAdmin
        .from("payments")
        .update({ gateway_order_id: rzData.id })
        .eq("id", payment_id);

      if (stampErr) {
        console.error("[create-order-v2] Failed to stamp gateway_order_id for Razorpay:", stampErr);
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Failed to stamp gateway_order_id");
        return new Response(
          JSON.stringify({ success: false, error: "internal_order_error" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          order_id,
          payment_id,
          gateway: "razorpay",
          key_id: keyId,
          razorpay_order_id: rzData.id,
          amount: rzData.amount,
          currency: "INR",
          gateway_response: {
            id: rzData.id,
            amount: rzData.amount,
            currency: rzData.currency,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // 5B. CASHFREE GATEWAY FLOW
    // =========================================================================
    if (finalGateway === "cashfree") {
      const clientId = Deno.env.get("CASHFREE_CLIENT_ID") || Deno.env.get("CASHFREE_APP_ID");
      const clientSecret = Deno.env.get("CASHFREE_CLIENT_SECRET") || Deno.env.get("CASHFREE_SECRET_KEY");
      const env = (Deno.env.get("CASHFREE_ENV") || "sandbox").toLowerCase();

      if (!clientId || !clientSecret) {
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Cashfree keys not configured");
        return new Response(
          JSON.stringify({ success: false, error: "Gateway 'cashfree' is not configured (missing keys)" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const isProduction = env === "production" || env === "prod";
      const cashfreeUrl = isProduction
        ? "https://api.cashfree.com/pg/orders"
        : "https://sandbox.cashfree.com/pg/orders";

      // Stamp payments.gateway_order_id with order_id upfront for Cashfree
      const { error: stampErr } = await supabaseAdmin
        .from("payments")
        .update({ gateway_order_id: String(order_id) })
        .eq("id", payment_id);

      if (stampErr) {
        console.error("[create-order-v2] Failed to stamp gateway_order_id:", stampErr);
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Failed to stamp gateway_order_id");
        return new Response(
          JSON.stringify({ success: false, error: "internal_order_error" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const orderTtlMin = Math.max(15, Number(Deno.env.get("CASHFREE_ORDER_TTL_MIN") || "20") || 20);
      const orderExpiryTime = new Date(Date.now() + orderTtlMin * 60 * 1000).toISOString();

      const rawPhone = String(
        user.phone ||
          user.user_metadata?.phone ||
          user.user_metadata?.phone_number ||
          user.user_metadata?.mobile ||
          ""
      ).replace(/[^0-9]/g, "");
      const customerPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : "9999999999";

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
        console.error("[create-order-v2] Cashfree PG Error:", cfData);
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Cashfree session creation failed");
        return new Response(
          JSON.stringify({ success: false, error: cfData.message || "Failed to create Cashfree session" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cfSessionId = String(cfData.payment_session_id || "").trim();
      if (!cfSessionId) {
        console.error("[create-order-v2] Cashfree returned no payment_session_id:", cfData);
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
          gateway_environment: isProduction ? "PRODUCTION" : "SANDBOX",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // 5C. EASEBUZZ GATEWAY FLOW
    // =========================================================================
    if (finalGateway === "easebuzz") {
      const key = Deno.env.get("EASEBUZZ_KEY") || Deno.env.get("EASEBUZZ_MERCHANT_KEY");
      const salt = Deno.env.get("EASEBUZZ_SALT");
      const env = (Deno.env.get("EASEBUZZ_ENV") || "test").toLowerCase();

      if (!key || !salt) {
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Easebuzz keys not configured");
        return new Response(
          JSON.stringify({ success: false, error: "Gateway 'easebuzz' is not configured (missing key or salt)" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const isProduction = env === "prod" || env === "production";
      const easebuzzUrl = isProduction
        ? "https://pay.easebuzz.in/payment/initiateLink"
        : "https://testpay.easebuzz.in/payment/initiateLink";

      const txnid = String(payment_id).replace(/[^a-zA-Z0-9_-]/g, "");
      const udf1 = String(order_id).replace(/[^a-zA-Z0-9_-]/g, "");
      const amount = Number(total_amount).toFixed(2);
      const productinfo = "HungerTapOrder";

      const rawName = user.user_metadata?.full_name || user.user_metadata?.name || "Customer";
      const firstname = rawName.replace(/[^a-zA-Z0-9]/g, "") || "Customer";

      const rawEmail = (user.email || "customer@hungertap.com").trim();
      const email = rawEmail.includes("@") ? rawEmail : "customer@hungertap.com";

      const digitsOnly = (user.phone || "").replace(/[^0-9]/g, "");
      const phone = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : "9999999999";

      const surl = Deno.env.get("EASEBUZZ_PAYMENT_SUCCESS_URL") || `${supabaseUrl}/functions/v1/easebuzz-webhook-v2`;
      const furl = Deno.env.get("EASEBUZZ_PAYMENT_FAILURE_URL") || `${supabaseUrl}/functions/v1/easebuzz-webhook-v2`;

      const udfs = [udf1, "", "", "", "", "", "", "", "", ""];
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
        console.error("[create-order-v2] Easebuzz PG Error:", ebData);
        await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Easebuzz session creation failed");
        return new Response(
          JSON.stringify({ success: false, error: ebData.data || ebData.error_desc || "Failed to initiate Easebuzz payment" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
          gateway_environment: isProduction ? "PRODUCTION" : "SANDBOX",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await voidFailedCheckout(supabaseAdmin, order_id, payment_id, `Unsupported gateway: ${finalGateway}`);
    return new Response(
      JSON.stringify({ success: false, error: `Unsupported gateway: ${finalGateway}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[create-order-v2] Server Exception:", err);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
