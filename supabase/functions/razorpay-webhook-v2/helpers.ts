/// @ts-nocheck
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature, x-razorpay-event-id",
};

export function paiseToRupees(paise: number | string): number {
  const p = Number(paise);
  if (!Number.isFinite(p) || p < 0) return 0;
  return Number((p / 100).toFixed(2));
}

export async function safeCompleteWebhook(
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

export async function verifyRazorpayHmac(
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
