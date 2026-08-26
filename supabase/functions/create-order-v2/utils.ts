import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Expose-Headers": "x-request-id",
};
export function toPaise(amount: number | string): number {
  const str = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) throw new Error(`Invalid monetary amount format: "${str}"`);
  const [rupeesStr, paiseStr = "00"] = str.split(".");
  const rupees = parseInt(rupeesStr, 10);
  const paise = parseInt(paiseStr.padEnd(2, "0").slice(0, 2), 10);
  if (!Number.isSafeInteger(rupees) || rupees < 0) throw new Error(`Invalid rupees value: "${rupeesStr}"`);
  const totalPaise = rupees * 100 + paise;
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) throw new Error(`Invalid calculated total paise value: "${totalPaise}"`);
  return totalPaise;
}
export async function sha512(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-512", buf);
  return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function buildRazorpayCheckoutToken(orderId: string, paymentId: string, secret: string, ttlSeconds = 3600): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadB64 = btoa(`${orderId}:${paymentId}:${expiresAt}`);
  const sig = await hmacSha256Hex(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}
export function sanitizeRpcError(rawMsg?: string): string {
  if (!rawMsg) return "Failed to process cart items";
  const lower = rawMsg.toLowerCase();
  if (lower.includes("out of stock") || lower.includes("insufficient_stock")) return "Some items in your cart are out of stock";
  if (lower.includes("item_unavailable")) return "Some items in your cart are currently unavailable";
  if (lower.includes("mixed_canteen")) return "Cart items must belong to a single canteen";
  if (lower.includes("invalid_item_quantity")) return "Invalid quantity specified for cart items";
  if (lower.includes("selected_gateway_unavailable")) return "The selected payment gateway is currently unavailable";
  if (lower.includes("no_active_default_gateway_configured")) return "No active payment gateway is currently configured";
  return rawMsg;
}
export async function voidFailedCheckout(supabaseAdmin: ReturnType<typeof createClient>, orderId: string, paymentId: string | null | undefined, reason: string, logger?: any): Promise<void> {
  try {
    logger?.info("Voiding failed checkout order", { orderId, paymentId, reason });
    const { error } = await supabaseAdmin.rpc("void_failed_checkout_order", { p_order_id: orderId, p_payment_id: paymentId || null, p_reason: reason });
    if (error) logger?.error("void_failed_checkout_order failed", error, { orderId, paymentId, reason }, true);
  } catch (err) {
    logger?.error("void_failed_checkout_order exception", err, { orderId, paymentId, reason }, true);
  }
}
