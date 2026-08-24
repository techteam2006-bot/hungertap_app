const fs = require("fs");
const crypto = require("crypto");

function sha(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

const disks = {
  "retry-refund": fs
    .readFileSync(
      "d:/TROVX WEBS/hungertap_app/supabase/functions/retry-refund/index.ts",
      "utf8"
    )
    .replace(/\r\n/g, "\n"),
  "create-order-v2": fs
    .readFileSync(
      "d:/TROVX WEBS/hungertap_app/supabase/migrations_pending/_extracted_create-order-v2.ts",
      "utf8"
    )
    .replace(/\r\n/g, "\n"),
  "razorpay-webhook-v2": fs
    .readFileSync(
      "d:/TROVX WEBS/hungertap_app/supabase/migrations_pending/_extracted_razorpay-webhook-v2.ts",
      "utf8"
    )
    .replace(/\r\n/g, "\n"),
  "verify-razorpay-payment": fs
    .readFileSync(
      "d:/TROVX WEBS/hungertap_app/supabase/migrations_pending/_extracted_verify-razorpay-payment.ts",
      "utf8"
    )
    .replace(/\r\n/g, "\n"),
};

const markers = {
  "retry-refund": [
    'gateway === "razorpay"',
    'gateway === "cashfree"',
    'gateway === "easebuzz"',
    "transaction/v2/refund",
    "HUNGERTAP_WEBHOOK_SECRET",
  ],
  "create-order-v2": [
    "RAZORPAY_KEY_ID",
    "create_order_v2_app",
    "payment_session_id",
    "void_failed_checkout_order",
    "5A. RAZORPAY",
  ],
  "razorpay-webhook-v2": [
    "claim_webhook_event",
    "apply_payment_success",
    "apply_refund_success",
    "RAZORPAY_WEBHOOK_SECRET",
    "refund.processed",
  ],
  "verify-razorpay-payment": [
    "client_verification_fast_path",
    "verifyRazorpaySignature",
    "apply_payment_success",
    "Unauthorized order verification",
  ],
};

for (const [name, content] of Object.entries(disks)) {
  const missing = markers[name].filter((m) => !content.includes(m));
  console.log(
    JSON.stringify({
      name,
      sha16: sha(content).slice(0, 16),
      len: content.length,
      missing_markers: missing,
    })
  );
}
