import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "./logger.ts";
import { corsHeaders, toPaise, sha512, buildRazorpayCheckoutToken, sanitizeRpcError, voidFailedCheckout } from "./utils.ts";
import { handleCashfreeOrEasebuzz } from "./gateways_alt.ts";

serve(async (req: Request) => {
const logger = createLogger("create-order-v2", { req });
if (req.method === "OPTIONS") {
return new Response("ok", { headers: logger.injectResponseHeaders(corsHeaders) });
}
const jsonResponse = (body: unknown, status = 200) => {
return new Response(JSON.stringify(body), {
status,
headers: logger.injectResponseHeaders({ ...corsHeaders, "Content-Type": "application/json" }),
});
};
try {
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const authHeader = req.headers.get("Authorization");
if (!authHeader) {
logger.warn("Missing authorization header", { failure_type: "business_failure" });
return jsonResponse({ success: false, error: "Missing authorization header" }, 401);
}
const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
global: { headers: { Authorization: authHeader } },
});
const { data: { user }, error: userErr } = await supabaseUserClient.auth.getUser();
if (userErr || !user) {
logger.warn("Unauthorized user session", { error: userErr?.message, failure_type: "business_failure" });
return jsonResponse({ success: false, error: "Unauthorized user session" }, 401);
}
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const reqLogger = logger.withContext({ userId: user.id });
const body = await req.json();
const { items, is_takeaway = false, gateway_code = null } = body || {};
if (!items || !Array.isArray(items) || items.length === 0) {
reqLogger.warn("Cart is empty or invalid", { failure_type: "business_failure" });
return jsonResponse({ success: false, error: "Cart is empty" }, 400);
}
reqLogger.info("Received checkout request", {
item_count: items.length,
is_takeaway: Boolean(is_takeaway),
requested_gateway: gateway_code,
});
let targetGatewayCode: string | null = null;
if (gateway_code && String(gateway_code).trim() !== "") {
const requested = String(gateway_code).trim().toLowerCase();
const { data: gwRow } = await supabaseAdmin
.from("payment_gateways")
.select("code, enabled, user_selectable")
.eq("code", requested)
.maybeSingle();
if (!gwRow || !gwRow.enabled || !gwRow.user_selectable) {
reqLogger.warn("Selected payment gateway unavailable", {
requested_gateway: requested,
failure_type: "business_failure",
});
return jsonResponse(
{ success: false, error: "The selected payment gateway is currently unavailable" },
400
);
}
targetGatewayCode = gwRow.code;
} else {
const { data: defRow } = await supabaseAdmin
.from("payment_gateways")
.select("code, enabled, is_default")
.eq("enabled", true)
.eq("is_default", true)
.maybeSingle();
if (!defRow || !defRow.code) {
reqLogger.error("No active default payment gateway configured", null, { failure_type: "system_failure" }, true);
return jsonResponse(
{ success: false, error: "No active payment gateway is currently configured" },
400
);
}
targetGatewayCode = defRow.code;
}
if (targetGatewayCode === "razorpay") {
const keyId = Deno.env.get("RAZORPAY_KEY_ID");
const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
if (!keyId || !keySecret) {
reqLogger.error("Gateway razorpay missing server keys", null, { failure_type: "system_failure" }, true);
return jsonResponse(
{ success: false, error: "Gateway 'razorpay' is not configured (missing server keys)" },
503
);
}
} else if (targetGatewayCode === "cashfree") {
const clientId = Deno.env.get("CASHFREE_CLIENT_ID") || Deno.env.get("CASHFREE_APP_ID");
const clientSecret = Deno.env.get("CASHFREE_CLIENT_SECRET") || Deno.env.get("CASHFREE_SECRET_KEY");
if (!clientId || !clientSecret) {
reqLogger.error("Gateway cashfree missing server keys", null, { failure_type: "system_failure" }, true);
return jsonResponse(
{ success: false, error: "Gateway 'cashfree' is not configured (missing server keys)" },
503
);
}
} else if (targetGatewayCode === "easebuzz") {
const key = Deno.env.get("EASEBUZZ_KEY") || Deno.env.get("EASEBUZZ_MERCHANT_KEY");
const salt = Deno.env.get("EASEBUZZ_SALT");
if (!key || !salt) {
reqLogger.error("Gateway easebuzz missing server keys", null, { failure_type: "system_failure" }, true);
return jsonResponse(
{ success: false, error: "Gateway 'easebuzz' is not configured (missing server keys)" },
503
);
}
}
const rpcTimer = reqLogger.startTimer("rpc_create_order_v2_app");
const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc("create_order_v2_app", {
p_gateway_code: targetGatewayCode,
p_is_takeaway: Boolean(is_takeaway),
p_items: items,
p_placed_by: user.id,
});
rpcTimer.done({ success: !rpcErr && Boolean(rpcRes?.success) });
if (rpcErr) {
reqLogger.error("create_order_v2_app RPC database error", rpcErr, { failure_type: "system_failure" }, true);
return jsonResponse({ success: false, error: sanitizeRpcError(rpcErr.message) }, 400);
}
if (!rpcRes || !rpcRes.success) {
reqLogger.warn("Order creation business rejection", {
reason: rpcRes?.error || "Order creation failed",
failure_type: "business_failure",
});
return jsonResponse(
{ success: false, error: sanitizeRpcError(rpcRes?.error || "Order creation failed") },
400
);
}
const { order_id, total_amount, payment_id, gateway_code: resolvedGatewayCode } = rpcRes;
const finalGateway = String(resolvedGatewayCode || "").toLowerCase();
const orderLogger = reqLogger.withContext({
orderId: order_id,
paymentId: payment_id,
gateway: finalGateway,
});
if (!payment_id) {
orderLogger.error("RPC returned no payment_id for order", null, { failure_type: "system_failure" }, true);
await voidFailedCheckout(supabaseAdmin, order_id, null, "Missing payment_id after order creation", orderLogger);
return jsonResponse({ success: false, error: "internal_order_error" }, 500);
}
if (finalGateway === "razorpay") {
const keyId = Deno.env.get("RAZORPAY_KEY_ID");
const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
if (!keyId || !keySecret) {
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Razorpay keys not configured on server", orderLogger);
return jsonResponse({ success: false, error: "Gateway 'razorpay' is not configured" }, 503);
}
let amountInPaise: number;
try {
amountInPaise = toPaise(total_amount);
} catch (err) {
orderLogger.error("toPaise calculation error", err, { total_amount, failure_type: "business_failure" }, false);
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Invalid monetary amount", orderLogger);
return jsonResponse({ success: false, error: "Invalid order amount" }, 400);
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
const gwTimer = orderLogger.startTimer("razorpay_orders_api");
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
gwTimer.done({ status_code: rzRes.status });
} catch (fetchErr) {
gwTimer.done({ status_code: 0, error: "network_exception" });
orderLogger.warn("Network exception on Razorpay POST order. Reconciling...", {
error: String(fetchErr),
});
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
orderLogger.info("Successfully reconciled existing Razorpay order by receipt", {
razorpay_order_id: rzData.id,
});
}
}
} catch (recErr) {
orderLogger.error("Razorpay reconciliation also timed out", recErr, { failure_type: "system_failure" }, true);
}
}
if (!rzRes?.ok || !rzData?.id) {
orderLogger.error("Razorpay session creation failed", null, {
gateway_response: rzData,
failure_type: "system_failure",
}, true);
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Razorpay session creation failed", orderLogger);
return jsonResponse(
{ success: false, error: rzData?.error?.description || "Failed to initiate Razorpay payment" },
400
);
}
const expireBy = Math.floor(Date.now() / 1000) + 600;
const { error: stampErr } = await supabaseAdmin
.from("payments")
.update({
gateway_order_id: rzData.id,
gateway_response: {
id: rzData.id,
amount: rzData.amount,
currency: rzData.currency,
expire_by: expireBy,
},
})
.eq("id", payment_id);
if (stampErr) {
orderLogger.error("Failed to stamp gateway_order_id for Razorpay", stampErr, { failure_type: "system_failure" }, true);
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Failed to stamp gateway_order_id", orderLogger);
return jsonResponse({ success: false, error: "internal_order_error" }, 500);
}
const supabaseUrlRoot = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
let rzPaymentUrl = "";
if (supabaseUrlRoot && keySecret) {
try {
const token = await buildRazorpayCheckoutToken(String(order_id), String(payment_id), keySecret);
rzPaymentUrl = `${supabaseUrlRoot}/functions/v1/razorpay-checkout?token=${encodeURIComponent(token)}`;
} catch (tokenErr) {
orderLogger.warn("Razorpay checkout token generation failed", { error: String(tokenErr) });
}
}
orderLogger.info("Order created successfully with Razorpay", {
gateway_order_id: rzData.id,
amount_paise: rzData.amount,
});
return jsonResponse({
success: true,
order_id,
payment_id,
gateway: "razorpay",
key_id: keyId,
razorpay_order_id: rzData.id,
amount: rzData.amount,
currency: "INR",
payment_url: rzPaymentUrl,
gateway_environment: (Deno.env.get("RAZORPAY_ENV") || "sandbox").toLowerCase() === "production"
? "PRODUCTION"
: "SANDBOX",
gateway_response: {
id: rzData.id,
amount: rzData.amount,
currency: rzData.currency,
},
});
}

const alt = await handleCashfreeOrEasebuzz({ finalGateway, supabaseAdmin, order_id, payment_id, total_amount, user, orderLogger, jsonResponse, supabaseUrl });
if (alt) return alt;
} catch (err: unknown) {
const message = err instanceof Error ? err.message : "Internal server error";
logger.fatal("Unhandled server exception in create-order-v2", err);
return jsonResponse({ success: false, error: message }, 500);
}
});
