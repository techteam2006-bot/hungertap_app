/// @ts-nocheck
// Supabase Edge Function (Deno runtime): razorpay-checkout
// Hosted Razorpay Standard Checkout page for WebView fallback (Expo Go / sideloaded APK).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function verifyCheckoutToken(token: string, secret: string): Promise<{ orderId: string; paymentId: string } | null> {
  const raw = String(token || "").trim();
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!payloadB64 || !sig) return null;

  const expected = await hmacSha256Hex(secret, payloadB64);
  if (expected.length !== sig.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  let decoded = "";
  try {
    decoded = atob(payloadB64);
  } catch {
    return null;
  }
  const parts = decoded.split(":");
  if (parts.length !== 3) return null;
  const [orderId, paymentId, expStr] = parts;
  const exp = parseInt(expStr, 10);
  if (!orderId || !paymentId || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return { orderId, paymentId };
}

function buildCheckoutHtml(opts: {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: string;
  orderId: string;
  paymentId: string;
}): string {
  const keyId = escapeHtml(opts.keyId);
  const orderId = escapeHtml(opts.razorpayOrderId);
  const amount = escapeHtml(opts.amountPaise);
  const appOrderId = escapeHtml(opts.orderId);
  const paymentId = escapeHtml(opts.paymentId);

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <style>
      body {
        margin: 0; padding: 0;
        background: #fff; color: #1a1a1a;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        display: flex; align-items: center; justify-content: center; height: 100vh;
      }
      .spinner {
        width: 40px; height: 40px;
        border: 4px solid rgba(0,0,0,0.08); border-left-color: #FFB301;
        border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .err { color: #b00020; padding: 24px; text-align: center; max-width: 320px; }
    </style>
  </head>
  <body>
    <div id="root" style="text-align:center;">
      <div class="spinner"></div>
      <div style="font-size:16px;font-weight:600;">Checkout</div>
      <div style="font-size:14px;color:#666;margin-top:4px;">Opening secure payment…</div>
    </div>
    <script>
      (function () {
        function showError(msg) {
          document.getElementById("root").innerHTML =
            '<div class="err"><strong>Could not open payment</strong><br/><br/>' + msg + '</div>';
        }
        function openCheckout() {
          if (!window.Razorpay) {
            showError("Payment page failed to load. Check your connection and try again.");
            return;
          }
          var options = {
            key: "${keyId}",
            amount: "${amount}",
            currency: "INR",
            order_id: "${orderId}",
            name: "HungerTap",
            description: "HungerTap order",
            theme: { color: "#FFB301" },
            notes: { order_id: "${appOrderId}", payment_id: "${paymentId}" },
            handler: function () {
              window.location.href = "hungertap://payment-success";
            },
            modal: {
              ondismiss: function () {
                window.location.href = "hungertap://payment-cancel";
              }
            }
          };
          try {
            var rzp = new Razorpay(options);
            rzp.on("payment.failed", function () {
              window.location.href = "hungertap://payment-failure";
            });
            rzp.open();
          } catch (e) {
            showError("Payment could not start. Please go back and try again.");
          }
        }
        if (window.Razorpay) {
          openCheckout();
        } else {
          document.querySelector('script[src*="checkout.razorpay.com"]').addEventListener("load", openCheckout);
          document.querySelector('script[src*="checkout.razorpay.com"]').addEventListener("error", function () {
            showError("Could not load Razorpay checkout. Check your connection.");
          });
        }
      })();
    </script>
  </body>
</html>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || "";
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
    const keyId = Deno.env.get("RAZORPAY_KEY_ID") || "";

    if (!keySecret || !keyId) {
      return new Response("Payment gateway is not configured.", {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const parsed = await verifyCheckoutToken(token, keySecret);
    if (!parsed) {
      return new Response("This payment link is invalid or has expired.", {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: payment, error: payErr } = await supabaseAdmin
      .from("payments")
      .select("id, gateway_order_id, amount, status, gateway_name")
      .eq("id", parsed.paymentId)
      .maybeSingle();

    if (payErr || !payment?.gateway_order_id) {
      return new Response("Payment session not found.", {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, status")
      .eq("id", parsed.orderId)
      .maybeSingle();

    if (!order || order.status !== "pending_payment") {
      return new Response("This order is no longer awaiting payment.", {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const amountPaise = payment.amount != null ? String(Math.round(Number(payment.amount) * 100)) : "";
    if (!amountPaise || !payment.gateway_order_id) {
      return new Response("Payment details are incomplete.", {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const html = buildCheckoutHtml({
      keyId,
      razorpayOrderId: String(payment.gateway_order_id),
      amountPaise,
      orderId: parsed.orderId,
      paymentId: parsed.paymentId,
    });

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[razorpay-checkout] error:", err);
    return new Response("Could not start checkout.", {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
});
