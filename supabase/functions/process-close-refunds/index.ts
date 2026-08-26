/// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

type LogContext = Record<string, unknown>;
class EdgeLogger {
  service: string; requestId: string; context: LogContext;
  constructor(service: string, options: any = {}) {
    this.service = service;
    this.requestId = options.requestId || crypto.randomUUID();
    this.context = options.context || {};
  }
  withContext(c: LogContext) { return new EdgeLogger(this.service, { requestId: this.requestId, context: { ...this.context, ...c } }); }
  injectResponseHeaders(headers: HeadersInit = {}) { const h = new Headers(headers); h.set("X-Request-Id", this.requestId); return h; }
  startTimer(_n: string) { return { done: () => 0 }; }
  info(m: string, c?: any) { console.log(JSON.stringify({ level: "INFO", service: this.service, message: m, ...c })); }
  warn(m: string, c?: any) { console.warn(JSON.stringify({ level: "WARN", service: this.service, message: m, ...c })); }
  error(m: string, e?: unknown, c?: any, _s = true) { console.error(JSON.stringify({ level: "ERROR", service: this.service, message: m, error: String(e), ...c })); }
  fatal(m: string, e?: unknown, c?: any) { this.error(m, e, c); }
}
function createLogger(service: string, options: any = {}) { return new EdgeLogger(service, options); }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Expose-Headers": "x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(logger: EdgeLogger, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: logger.injectResponseHeaders({ ...corsHeaders, "Content-Type": "application/json" }),
  });
}

async function sha512(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-512", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  const logger = createLogger("process-close-refunds", { req });
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: logger.injectResponseHeaders(corsHeaders) });
  }
  try {
    const expectedSecret = Deno.env.get("HUNGERTAP_WEBHOOK_SECRET");
    if (!expectedSecret) {
      logger.error("HUNGERTAP_WEBHOOK_SECRET is not configured", null, { failure_type: "system_failure" }, true);
      return json(logger, { success: false, error: "server_misconfigured" }, 500);
    }
    const got = req.headers.get("x-hungertap-webhook-secret") || "";
    if (got !== expectedSecret) {
      return json(logger, { success: false, error: "unauthorized" }, 401);
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 50, 100);
    const canteenId = body.canteen_id || body.canteenId || null;
    const queryLogger = logger.withContext({ canteenId: canteenId || undefined });
    const { data: refunds, error: listError } = await supabase
      .from("refunds").select("*").eq("status", "initiated").ilike("reason", "Canteen close%")
      .order("created_at", { ascending: true }).limit(limit);
    if (listError) throw new Error(listError.message);
    if (!refunds?.length) {
      queryLogger.info("No initiated canteen close refunds to process");
      return json(queryLogger, { success: true, processed: 0, results: [] });
    }
    queryLogger.info(`Found ${refunds.length} refunds to process`);
    const ENV = (Deno.env.get("EASEBUZZ_ENV") || "test").toLowerCase() === "production" ? "production" : "test";
    const DASHBOARD_URL = ENV === "production" ? "https://dashboard.easebuzz.in" : "https://testdashboard.easebuzz.in";
    const key = Deno.env.get("EASEBUZZ_KEY")!;
    const salt = Deno.env.get("EASEBUZZ_SALT")!;
    const results: unknown[] = [];
    for (const refund of refunds) {
      const itemLogger = queryLogger.withContext({ orderId: refund.order_id, paymentId: refund.payment_id });
      try {
        if (canteenId) {
          const { data: archived } = await supabase.from("archived_orders").select("canteen_id").eq("id", refund.order_id).maybeSingle();
          const { data: live } = archived ? { data: null } : await supabase.from("orders").select("canteen_id").eq("id", refund.order_id).maybeSingle();
          const cid = archived?.canteen_id || live?.canteen_id;
          if (cid && cid !== canteenId) continue;
        }
        const { data: payment, error: paymentError } = await supabase.from("payments").select("*").eq("id", refund.payment_id).single();
        if (paymentError || !payment) {
          itemLogger.error("Payment missing for close refund", paymentError, { failure_type: "system_failure" }, true);
          results.push({ refund_id: refund.id, ok: false, error: "payment missing" });
          continue;
        }
        let email: string | null = refund.customer_email ?? null;
        let placedBy: string | null = null;
        if (!email) {
          const { data: order } = await supabase.from("orders").select("placed_by").eq("id", refund.order_id).maybeSingle();
          placedBy = order?.placed_by ?? null;
        }
        if (!email && !placedBy) {
          const { data: archived } = await supabase.from("archived_orders").select("placed_by").eq("id", refund.order_id).maybeSingle();
          placedBy = archived?.placed_by ?? null;
        }
        if (!email && placedBy) {
          const { data: userData } = await supabase.auth.admin.getUserById(placedBy);
          email = userData?.user?.email ?? null;
        }
        if (!email) {
          itemLogger.warn("Customer email missing for close refund", { failure_type: "business_failure" });
          results.push({ refund_id: refund.id, ok: false, error: "email missing" });
          continue;
        }
        const txnid = payment.gateway_payment_id;
        if (!txnid) {
          itemLogger.warn("Gateway payment ID missing for close refund", { failure_type: "business_failure" });
          results.push({ refund_id: refund.id, ok: false, error: "txnid missing" });
          continue;
        }
        const amount = Number(refund.amount).toFixed(1);
        const hash = await sha512(`${key}|${txnid}|${amount}|${amount}|${email}|9999999999|${salt}`);
        const refundTimer = itemLogger.startTimer("easebuzz_refund_api_call");
        const refundRes = await fetch(`${DASHBOARD_URL}/transaction/v1/refund`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ key, txnid, amount, refund_amount: amount, email, phone: "9999999999", hash }),
        });
        refundTimer.done({ status: refundRes.status });
        const refundData = await refundRes.json();
        const success = refundData?.status === 1 || refundData?.status === "1" || refundData?.status === true;
        await supabase.from("refunds").update({
          status: success ? "success" : "failed",
          retry_count: success ? refund.retry_count : (refund.retry_count ?? 0) + 1,
          gateway_response: refundData,
          gateway_refund_id: refundData?.refund_id || refundData?.refund_txn_id || null,
          refunded_at: success ? new Date().toISOString() : null,
          customer_email: email,
        }).eq("id", refund.id);
        await supabase.from("payments").update({ status: success ? "refunded" : "refund_failed" }).eq("id", payment.id);
        itemLogger.info("Processed canteen close refund item", { refundId: refund.id, success });
        results.push({ refund_id: refund.id, ok: true, refunded: success });
      } catch (e) {
        itemLogger.error("Exception processing close refund item", e, { failure_type: "system_failure" }, true);
        results.push({ refund_id: refund.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    queryLogger.info("Finished processing canteen close refunds batch", { count: results.length });
    return json(queryLogger, { success: true, processed: results.length, results });
  } catch (e) {
    logger.fatal("Unhandled exception in process-close-refunds", e);
    return json(logger, { success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
