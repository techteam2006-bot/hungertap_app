/// @ts-nocheck
// Supabase Edge Function (Deno runtime): retry-refund
// Multi-gateway refund processor invoked by notify_refund_edge with { refund_id }.
// Supports razorpay / cashfree / easebuzz. Easebuzz uses live v2 API.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =========================================================================
// INLINED SHARED LOGGER
// =========================================================================

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export type FailureType = "business_failure" | "system_failure";

export interface LogContext {
  orderId?: string;
  paymentId?: string;
  userId?: string;
  canteenId?: string;
  gateway?: string;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  gatewayRefundId?: string;
  webhookEventId?: string;
  failureType?: FailureType;
  [key: string]: unknown;
}

export interface ErrorDetails {
  name?: string;
  message?: string;
  code?: string | number;
  stack?: string;
  raw?: unknown;
}

export interface LoggerOptions {
  req?: Request;
  requestId?: string;
  context?: LogContext;
  supabaseAdmin?: any;
}

const SENSITIVE_KEY_REGEX =
  /^(password|secret|key_secret|token|authorization|salt|otp|card|cvv|pan|account_number|service_role_key|api_key|cookie|session_id)$/i;

const REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{1,100}$/;

const LIMITS = {
  MAX_DEPTH: 6,
  MAX_STRING_LENGTH: 2048,
  MAX_ARRAY_ITEMS: 50,
  MAX_OBJECT_KEYS: 100,
  MAX_SERIALIZED_BYTES: 8192,
};

/**
 * Extracts and strictly validates incoming request ID or generates a fresh one.
 */
export function resolveRequestId(req?: Request, explicitId?: string): string {
  if (explicitId && REQUEST_ID_REGEX.test(explicitId)) {
    return explicitId;
  }
  if (req) {
    const headerId =
      req.headers.get("x-request-id") ||
      req.headers.get("cf-ray") ||
      req.headers.get("x-sb-request-id");
    if (headerId && REQUEST_ID_REGEX.test(headerId.trim())) {
      return headerId.trim();
    }
  }
  return `req_${crypto.randomUUID()}`;
}

/**
 * Recursively redacts sensitive keys and applies strict depth, string, array, and key limits.
 */
export function sanitizeData(
  val: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (val === null || val === undefined) return val;

  if (typeof val === "string") {
    if (val.length > LIMITS.MAX_STRING_LENGTH) {
      return `${val.slice(0, LIMITS.MAX_STRING_LENGTH)}... [Truncated ${val.length - LIMITS.MAX_STRING_LENGTH} chars]`;
    }
    return val;
  }

  if (typeof val === "number" || typeof val === "boolean") {
    return val;
  }

  if (typeof val === "bigint") {
    return val.toString();
  }

  if (depth >= LIMITS.MAX_DEPTH) {
    return "[Max Depth Reached]";
  }

  if (val instanceof Error) {
    return {
      name: val.name,
      message: val.message ? String(val.message).slice(0, LIMITS.MAX_STRING_LENGTH) : "",
      stack: val.stack ? String(val.stack).slice(0, LIMITS.MAX_STRING_LENGTH) : undefined,
      ...(val as any).code ? { code: (val as any).code } : {},
    };
  }

  if (typeof val === "object") {
    if (seen.has(val)) {
      return "[Circular]";
    }
    seen.add(val);

    if (Array.isArray(val)) {
      const sliced = val.slice(0, LIMITS.MAX_ARRAY_ITEMS);
      const res = sliced.map((item) => sanitizeData(item, depth + 1, seen));
      if (val.length > LIMITS.MAX_ARRAY_ITEMS) {
        res.push(`[+${val.length - LIMITS.MAX_ARRAY_ITEMS} items truncated]`);
      }
      return res;
    }

    const out: Record<string, unknown> = {};
    const entries = Object.entries(val as Record<string, unknown>);
    const limitedEntries = entries.slice(0, LIMITS.MAX_OBJECT_KEYS);

    for (const [k, v] of limitedEntries) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitizeData(v, depth + 1, seen);
      }
    }

    if (entries.length > LIMITS.MAX_OBJECT_KEYS) {
      out["_keys_truncated"] = entries.length - LIMITS.MAX_OBJECT_KEYS;
    }
    return out;
  }

  return String(val);
}

/**
 * Formats data to valid JSON while guaranteeing the serialized output stays within byte limits.
 */
function safeJsonSerialize(payload: Record<string, unknown>): string {
  try {
    const jsonStr = JSON.stringify(payload);
    if (jsonStr.length <= LIMITS.MAX_SERIALIZED_BYTES) {
      return jsonStr;
    }
    return JSON.stringify({
      timestamp: payload.timestamp,
      level: payload.level,
      service: payload.service,
      request_id: payload.request_id,
      message: payload.message,
      truncated: true,
      original_bytes: jsonStr.length,
      preview: typeof payload.message === "string" ? payload.message.slice(0, 500) : "Payload exceeded 8KB",
    });
  } catch (err) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      service: String(payload.service || "unknown"),
      message: "safeJsonSerialize failed",
      error: String(err),
    });
  }
}

/**
 * Standard Scoped Logger
 */
export class EdgeLogger {
  readonly service: string;
  readonly requestId: string;
  private context: LogContext;
  private supabaseAdmin?: any;
  private httpMeta?: { method?: string; path?: string; userAgent?: string };

  constructor(service: string, options: LoggerOptions = {}) {
    this.service = service;
    this.requestId = resolveRequestId(options.req, options.requestId);
    this.context = options.context ? (sanitizeData(options.context) as LogContext) : {};
    this.supabaseAdmin = options.supabaseAdmin;

    if (options.req) {
      try {
        const url = new URL(options.req.url);
        this.httpMeta = {
          method: options.req.method,
          path: url.pathname,
          userAgent: options.req.headers.get("user-agent") || undefined,
        };
      } catch {
        // Safe fallback
      }
    }
  }

  /**
   * Creates a child logger inheriting current trace identifiers.
   */
  withContext(childContext: LogContext): EdgeLogger {
    const merged: LogContext = {
      ...this.context,
      ...childContext,
    };
    const child = new EdgeLogger(this.service, {
      requestId: this.requestId,
      context: merged,
      supabaseAdmin: this.supabaseAdmin,
    });
    child.httpMeta = this.httpMeta;
    return child;
  }

  /**
   * Injects correlation headers (X-Request-Id) into an outgoing headers object or response.
   */
  injectResponseHeaders(headers: HeadersInit = {}): Headers {
    const h = new Headers(headers);
    h.set("X-Request-Id", this.requestId);
    return h;
  }

  /**
   * Measures the duration of a boundary operation (RPC, Payment Gateway API, etc.)
   */
  startTimer(boundaryName: string) {
    const startTime = performance.now();
    return {
      done: (metadata?: Record<string, unknown>, level: LogLevel = "INFO") => {
        const durationMs = Math.round(performance.now() - startTime);
        this.log(level, `[Boundary] ${boundaryName} completed in ${durationMs}ms`, {
          boundary: boundaryName,
          duration_ms: durationMs,
          ...metadata,
        });
        return durationMs;
      },
    };
  }

  /**
   * Logs an explicit idempotency decision.
   */
  idempotency(decision: string, details?: Record<string, unknown>) {
    this.info(`[Idempotency] ${decision}`, {
      idempotency_decision: decision,
      ...details,
    });
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.log("DEBUG", message, context);
  }

  info(message: string, context?: Record<string, unknown>) {
    this.log("INFO", message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.log("WARN", message, context);
  }

  /**
   * Log an operational/system error.
   * If isSystemFailure = true, this is marked as an unexpected operational failure.
   */
  error(message: string, error?: unknown, context?: Record<string, unknown>, isSystemFailure = true) {
    this.log("ERROR", message, context, error, isSystemFailure);
  }

  fatal(message: string, error?: unknown, context?: Record<string, unknown>) {
    this.log("FATAL", message, context, error, true);
  }

  /**
   * Main dispatch method. Guaranteed to never throw.
   */
  private log(
    level: LogLevel,
    message: string,
    extraContext?: Record<string, unknown>,
    error?: unknown,
    isSystemFailure = false
  ) {
    try {
      const now = new Date().toISOString();
      const sanitizedContext = sanitizeData({
        ...this.context,
        ...extraContext,
      }) as Record<string, unknown>;

      let errorObj: ErrorDetails | undefined;
      if (error) {
        if (error instanceof Error) {
          errorObj = {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: (error as any).code,
          };
        } else if (typeof error === "object") {
          errorObj = sanitizeData(error) as ErrorDetails;
        } else {
          errorObj = { message: String(error) };
        }
      }

      const payload: Record<string, unknown> = {
        timestamp: now,
        level,
        service: this.service,
        request_id: this.requestId,
        message,
      };

      if (this.context.orderId || sanitizedContext.orderId) {
        payload.order_id = sanitizedContext.orderId || this.context.orderId;
      }
      if (this.context.paymentId || sanitizedContext.paymentId) {
        payload.payment_id = sanitizedContext.paymentId || this.context.paymentId;
      }
      if (this.context.userId || sanitizedContext.userId) {
        payload.user_id = sanitizedContext.userId || this.context.userId;
      }
      if (this.context.gateway || sanitizedContext.gateway) {
        payload.gateway = sanitizedContext.gateway || this.context.gateway;
      }
      if (sanitizedContext.duration_ms !== undefined) {
        payload.duration_ms = sanitizedContext.duration_ms;
      }

      payload.context = sanitizedContext;
      if (errorObj) payload.error = errorObj;
      if (this.httpMeta) payload.http = this.httpMeta;

      const serialized = safeJsonSerialize(payload);

      // Stdout stream (primary source of truth for Supabase Logflare)
      if (level === "ERROR" || level === "FATAL") {
        console.error(serialized);
      } else if (level === "WARN") {
        console.warn(serialized);
      } else {
        console.log(serialized);
      }

      // Optional DB persistence for unexpected operational/system failures only
      if (isSystemFailure && (level === "ERROR" || level === "FATAL")) {
        this.persistSystemError(level, message, errorObj, sanitizedContext);
      }
    } catch (fallbackErr) {
      // Zero-exception guarantee: never disrupt business execution
      try {
        console.error(
          `[LOGGER_FALLBACK_FAILSAFE] ${level} ${this.service} [${this.requestId}] ${message}`,
          fallbackErr
        );
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Non-blocking, safe insertion into system_error_logs table.
   * Only executes if ENABLE_DB_ERROR_LOGGING === "true".
   */
  private persistSystemError(
    level: LogLevel,
    message: string,
    errorObj?: ErrorDetails,
    context?: Record<string, unknown>
  ) {
    try {
      const isDbLoggingEnabled =
        typeof Deno !== "undefined" &&
        Deno.env.get("ENABLE_DB_ERROR_LOGGING") === "true";

      if (!isDbLoggingEnabled || !this.supabaseAdmin) {
        return;
      }

      const orderId =
        typeof context?.orderId === "string" && context.orderId.length === 36
          ? context.orderId
          : null;
      const userId =
        typeof context?.userId === "string" && context.userId.length === 36
          ? context.userId
          : null;

      // Fire-and-forget: never await, never catch into caller
      this.supabaseAdmin
        .from("system_error_logs")
        .insert({
          service: this.service,
          level: level.toLowerCase(),
          request_id: this.requestId,
          order_id: orderId,
          user_id: userId,
          message: message.slice(0, 1000),
          error_code: errorObj?.code ? String(errorObj.code).slice(0, 100) : null,
          error_details: errorObj || null,
          context: context || null,
          http_metadata: this.httpMeta || null,
        })
        .then(() => {})
        .catch((dbErr: unknown) => {
          // Log locally without re-throwing
          console.warn("[Logger DB persist failed safely]", String(dbErr));
        });
    } catch {
      // Ignore
    }
  }
}

/**
 * Factory function to create an EdgeLogger instance.
 */
export function createLogger(service: string, options: LoggerOptions = {}): EdgeLogger {
  return new EdgeLogger(service, options);
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hungertap-webhook-secret, x-request-id",
  "Access-Control-Expose-Headers": "x-request-id",
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
  const logger = createLogger("retry-refund", { req });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: logger.injectResponseHeaders(corsHeaders) });
  }

  const json = (body: unknown, status = 200) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: logger.injectResponseHeaders({ ...corsHeaders, "Content-Type": "application/json" }),
    });
  };

  try {
    const expectedSecret = Deno.env.get("HUNGERTAP_WEBHOOK_SECRET");
    if (!expectedSecret) {
      logger.error("HUNGERTAP_WEBHOOK_SECRET is not configured", null, { failure_type: "system_failure" }, true);
      return json({ success: false, error: "server_misconfigured" }, 500);
    }
    const got = req.headers.get("x-hungertap-webhook-secret") || "";
    if (got !== expectedSecret) {
      logger.warn("Unauthorized webhook secret on retry-refund", { failure_type: "business_failure" });
      return json({ success: false, error: "unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const refundId = extractRefundId(body);
    if (!refundId) {
      logger.warn("Missing refund_id in request body", { failure_type: "business_failure" });
      throw new Error("Missing refund_id");
    }

    const refundLogger = logger.withContext({ refundId });

    let refundSource: "live" | "archived" = "live";
    let { data: refund, error: refundError } = await supabase
      .from("refunds")
      .select("*")
      .eq("id", refundId)
      .maybeSingle();

    if (refundError) throw new Error(refundError.message);
    if (!refund) {
      const archived = await supabase.from("archived_refunds").select("*").eq("id", refundId).maybeSingle();
      if (archived.error) throw new Error(archived.error.message);
      refund = archived.data;
      refundSource = "archived";
    }

    if (!refund) throw new Error("Refund not found");
    const refundRow = refund as RefundRow;

    if (refundRow.status === "success") {
      refundLogger.idempotency("refund_already_completed", { refundId });
      return json({ success: true, message: "Already refunded", refund_id: refundId });
    }
    if (refundRow.status === "processing") {
      refundLogger.idempotency("refund_already_processing", { refundId });
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

    const refundTable = refundSource === "live" ? "refunds" : "archived_refunds";

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
        .from("archived_payments")
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
    const ctxLogger = refundLogger.withContext({
      orderId: refundRow.order_id,
      paymentId: refundRow.payment_id,
      gateway,
    });

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
        .from("archived_orders")
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

      const merchantKey =
        Deno.env.get("EASEBUZZ_KEY") || Deno.env.get("EASEBUZZ_MERCHANT_KEY") || "";
      const salt = Deno.env.get("EASEBUZZ_SALT") || "";
      if (!merchantKey || !salt) {
        await supabase
          .from(refundTable)
          .update({
            status: "failed",
            retry_count: retryCount + 1,
            failure_reason: "easebuzz_keys_missing",
          })
          .eq("id", refundId);
        throw new Error("Easebuzz keys not configured");
      }

      const refundAmount = formatEasebuzzAmount(refundRow.amount);
      const refundReason = "HungerTap refund";
      const hashStr = `${merchantKey}|${easebuzzId}|${refundAmount}|${refundReason}|${salt}`;
      const hash = await sha512(hashStr);

      const form = new URLSearchParams();
      form.set("merchant_key", merchantKey);
      form.set("easepayid", easebuzzId);
      form.set("refund_amount", refundAmount);
      form.set("refund_reason", refundReason);
      form.set("hash", hash);

      apiUsed = "easebuzz/transaction/v2/refund";

      try {
        const ebTimer = ctxLogger.startTimer("easebuzz_refund_api") ?? {
          done: () => {},
        };
        const ebRes = await fetch(`${DASHBOARD_URL}/transaction/v2/refund`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: form.toString(),
        });
        ebTimer.done({ status_code: ebRes.status });

        const raw = await ebRes.text();
        try {
          refundData = JSON.parse(raw);
        } catch {
          refundData = { raw };
        }

        gatewayOk = ebRes.ok && Boolean(refundData.status);
        if (!gatewayOk) {
          failureReason = String(
            refundData.data ||
              refundData.error_desc ||
              refundData.reason ||
              `easebuzz_status_${ebRes.status}`,
          ).slice(0, 500);
          ctxLogger.error(
            "Easebuzz refund API call failed",
            null,
            { failure_reason: failureReason, failure_type: "system_failure" },
            true,
          );
        }
        gatewayRefundId =
          (typeof refundData.data === "string" && refundData.data) ||
          (refundData.refund_id as string) ||
          null;
      } catch (e) {
        refundData = { error: e instanceof Error ? e.message : String(e) };
        failureReason = `easebuzz_request_error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
        gatewayOk = false;
        ctxLogger.error(
          "Easebuzz refund network exception",
          e,
          { failure_type: "system_failure" },
          true,
        );
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

    const paymentTable = paymentSource === "live" ? "payments" : "archived_payments";
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
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.error("Refund retry exception", e, { failure_type: "system_failure" }, true);
    return json({ success: false, error: errorMsg }, 500);
  }
});