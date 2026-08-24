/// @ts-nocheck
// Supabase Edge Function (Deno runtime): verify-razorpay-payment
// Fast-path client callback verification for Razorpay React Native SDK

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Web Crypto HMAC-SHA256 Signature Verification with constant-time equality check. */
async function verifyRazorpaySignature(
  secret: string,
  orderId: string,
  paymentId: string,
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
    const dataToSign = `${orderId}|${paymentId}`;
    const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(dataToSign));
    const generatedHex = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (generatedHex.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < generatedHex.length; i++) {
      mismatch |= generatedHex.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  } catch (err) {
    console.error("[verify-razorpay-payment] Signature verification exception:", err);
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const razorpaySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";

    if (!razorpaySecret) {
      console.error("[verify-razorpay-payment] RAZORPAY_KEY_SECRET is not configured");
      return new Response(JSON.stringify({ success: false, error: "Server gateway configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Authenticate user from Auth Header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseUserClient.auth.getUser();

    if (userErr || !user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Parse payload from client
    const body = await req.json();
    const {
      order_id,
      payment_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body || {};

    if (!order_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required payment verification parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Cryptographic Signature Verification
    const isValid = await verifyRazorpaySignature(
      razorpaySecret,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      console.warn("[verify-razorpay-payment] Invalid Razorpay payment signature from client callback");
      return new Response(
        JSON.stringify({ success: false, error: "Invalid payment signature" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Strict Ownership & Gateway Relationship Check
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: paymentRow, error: pErr } = await supabaseAdmin
      .from("payments")
      .select(`
        id,
        order_id,
        amount,
        gateway_name,
        gateway_order_id,
        status,
        orders!inner(id, placed_by, status)
      `)
      .eq("order_id", order_id)
      .eq("gateway_name", "razorpay")
      .maybeSingle();

    if (pErr || !paymentRow) {
      console.error("[verify-razorpay-payment] Payment record not found:", pErr);
      return new Response(
        JSON.stringify({ success: false, error: "Payment record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify calling user owns this order
    if (paymentRow.orders?.placed_by !== user.id) {
      console.warn(`[verify-razorpay-payment] User ${user.id} attempted to verify order owned by ${paymentRow.orders?.placed_by}`);
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized order verification" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update gateway_order_id if currently null
    if (!paymentRow.gateway_order_id) {
      await supabaseAdmin
        .from("payments")
        .update({ gateway_order_id: razorpay_order_id })
        .eq("id", paymentRow.id);
    }

    // 5. Invoke apply_payment_success RPC (Database Financial Boundary)
    const { data: apsRes, error: apsErr } = await supabaseAdmin.rpc("apply_payment_success", {
      p_payment_id: paymentRow.id,
      p_order_id: paymentRow.order_id,
      p_gateway_payment_id: razorpay_payment_id,
      p_gateway_response: {
        razorpay_order_id,
        razorpay_payment_id,
        source: "client_verification_fast_path",
      },
      p_gateway_name: "razorpay",
      p_verify_amount: Number(paymentRow.amount),
      p_verify_currency: "INR",
    });

    if (apsErr || !apsRes?.success) {
      const err = apsErr?.message || apsRes?.error || "Payment finalization failed";
      console.error("[verify-razorpay-payment] apply_payment_success failed:", err);
      return new Response(
        JSON.stringify({ success: false, error: err }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        order_id: paymentRow.order_id,
        action: apsRes?.action,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[verify-razorpay-payment] Server exception:", err);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
