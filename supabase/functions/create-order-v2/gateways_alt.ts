import { sha512, voidFailedCheckout } from "./utils.ts";

export async function handleCashfreeOrEasebuzz(ctx: any): Promise<Response | null> {
  const { finalGateway, supabaseAdmin, order_id, payment_id, total_amount, user, orderLogger, jsonResponse, supabaseUrl } = ctx;
if (finalGateway === "cashfree") {
const clientId = Deno.env.get("CASHFREE_CLIENT_ID") || Deno.env.get("CASHFREE_APP_ID");
const clientSecret = Deno.env.get("CASHFREE_CLIENT_SECRET") || Deno.env.get("CASHFREE_SECRET_KEY");
const env = (Deno.env.get("CASHFREE_ENV") || "sandbox").toLowerCase();
if (!clientId || !clientSecret) {
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Cashfree keys not configured", orderLogger);
return jsonResponse(
{ success: false, error: "Gateway 'cashfree' is not configured (missing keys)" },
503
);
}
const isProduction = env === "production" || env === "prod";
const cashfreeUrl = isProduction
? "https://api.cashfree.com/pg/orders"
: "https://sandbox.cashfree.com/pg/orders";
const { error: stampErr } = await supabaseAdmin
.from("payments")
.update({ gateway_order_id: String(order_id) })
.eq("id", payment_id);
if (stampErr) {
orderLogger.error("Failed to stamp gateway_order_id for Cashfree", stampErr, { failure_type: "system_failure" }, true);
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Failed to stamp gateway_order_id", orderLogger);
return jsonResponse({ success: false, error: "internal_order_error" }, 500);
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
customer_email: user.email || user.user_metadata?.email || "customer@hungertap.com",
},
order_meta: {
notify_url: `${supabaseUrl}/functions/v1/cashfree-webhook-v2`,
},
};
const cfTimer = orderLogger.startTimer("cashfree_orders_api");
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
cfTimer.done({ status_code: cfRes.status });
const cfData = await cfRes.json();
if (!cfRes.ok) {
orderLogger.error("Cashfree PG Error", null, {
gateway_response: cfData,
failure_type: "system_failure",
}, true);
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Cashfree session creation failed", orderLogger);
return jsonResponse(
{ success: false, error: cfData.message || "Failed to create Cashfree session" },
400
);
}
const cfSessionId = String(cfData.payment_session_id || "").trim();
if (!cfSessionId) {
orderLogger.error("Cashfree returned no payment_session_id", null, { failure_type: "system_failure" }, true);
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Cashfree returned no payment_session_id", orderLogger);
return jsonResponse(
{ success: false, error: "Cashfree did not return a payment session" },
400
);
}
const cfPaymentUrl = isProduction
? `https://payments.cashfree.com/order/#${cfSessionId}`
: `https://sandbox.cashfree.com/order/#${cfSessionId}`;
orderLogger.info("Order created successfully with Cashfree", {
payment_session_id: cfSessionId,
});
return jsonResponse({
success: true,
order_id,
payment_id,
gateway: "cashfree",
payment_session_id: cfSessionId,
payment_url: cfPaymentUrl,
gateway_environment: isProduction ? "PRODUCTION" : "SANDBOX",
});
}
if (finalGateway === "easebuzz") {
const key = Deno.env.get("EASEBUZZ_KEY") || Deno.env.get("EASEBUZZ_MERCHANT_KEY");
const salt = Deno.env.get("EASEBUZZ_SALT");
const env = (Deno.env.get("EASEBUZZ_ENV") || "test").toLowerCase();
if (!key || !salt) {
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Easebuzz keys not configured", orderLogger);
return jsonResponse(
{ success: false, error: "Gateway 'easebuzz' is not configured (missing key or salt)" },
503
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
const rawEmail = (user.email || user.user_metadata?.email || "customer@hungertap.com").trim();
const email = rawEmail.includes("@") ? rawEmail : "customer@hungertap.com";
const rawPhone = String(
user.phone ||
user.user_metadata?.phone ||
user.user_metadata?.phone_number ||
user.user_metadata?.mobile ||
""
).replace(/[^0-9]/g, "");
const phone = rawPhone.length >= 10 ? rawPhone.slice(-10) : "9999999999";
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
const ebTimer = orderLogger.startTimer("easebuzz_initiate_api");
const ebRes = await fetch(easebuzzUrl, {
method: "POST",
headers: { "Content-Type": "application/x-www-form-urlencoded" },
body: formData.toString(),
});
ebTimer.done({ status_code: ebRes.status });
const ebData = await ebRes.json();
if (!ebRes.ok || ebData.status !== 1) {
orderLogger.error("Easebuzz PG Error", null, {
gateway_response: ebData,
failure_type: "system_failure",
}, true);
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, "Easebuzz session creation failed", orderLogger);
return jsonResponse(
{ success: false, error: ebData.data || ebData.error_desc || "Failed to initiate Easebuzz payment" },
400
);
}
const accessKey = ebData.data;
const paymentUrl = isProduction
? `https://pay.easebuzz.in/pay/${accessKey}`
: `https://testpay.easebuzz.in/pay/${accessKey}`;
orderLogger.info("Order created successfully with Easebuzz", {
payment_session_id: accessKey,
});
return jsonResponse({
success: true,
order_id,
payment_id,
gateway: "easebuzz",
payment_session_id: accessKey,
payment_url: paymentUrl,
gateway_environment: isProduction ? "PRODUCTION" : "SANDBOX",
});
}
orderLogger.error(`Unsupported gateway: ${finalGateway}`, null, { failure_type: "system_failure" }, true);
await voidFailedCheckout(supabaseAdmin, order_id, payment_id, `Unsupported gateway: ${finalGateway}`, orderLogger);
return jsonResponse({ success: false, error: `Unsupported gateway: ${finalGateway}` }, 400);

  return null;
}
