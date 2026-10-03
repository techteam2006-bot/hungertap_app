# Payment Processing & Gateway Verification Audit

**Date:** September 30, 2026  
**Target:** HungerTap Client Payment Flow & Backend Gateway Validation  
**Files Audited:**
- `screens/PaymentProcessingScreen.js`
- `lib/easebuzzCheckout.js`
- `lib/cashfreeCheckout.js`
- `lib/razorpayCheckout.js`
- `lib/paymentDeepLink.js`
- `lib/cancelCheckoutPayment.js`
- `supabase/functions/create-order-v2/index.ts`
- `supabase/functions/create-order-v2/gateways_alt.ts`
- `supabase/migrations_pending/04_offers_discount.sql`

---

## 1. Executive Summary

When returning from a payment gateway without completing payment (e.g., tapping Back, Cancel, or dismissing the payment gateway), the app becomes stuck on **"Verifying your payment…"** with a spinner for an extended duration (~30 seconds), eventually showing an alert:
> *"Verification Taking Longer: Your payment is being verified with the bank. Please check My Orders to see your order status."*

This document outlines:
1. **How the backend validates whether payment gateways are enabled** before creating orders.
2. **Root cause analysis** of why the client gets stuck in the verification state when returning without payment.
3. **Comprehensive scenario audit** covering all gateways and return flows (with payment, without payment, cancelled, failed).
4. **Remediation roadmap** to ensure instantaneous, clean cancellation and exit back to the cart.

---

## 2. Backend Gateway Enablement Verification

Before placing an order or initiating a payment session, the backend enforces a **dual-layer validation**:

### Layer 1: Edge Function Validation (`create-order-v2/index.ts`)

1. **User-Selected Gateway Check (`lines 51–65`):**
   ```typescript
   const { data: gwRow } = await supabaseAdmin
     .from("payment_gateways")
     .select("code, enabled, user_selectable")
     .eq("code", requested)
     .maybeSingle();

   if (!gwRow || !gwRow.enabled || !gwRow.user_selectable) {
     return jsonResponse(
       { success: false, error: "The selected payment gateway is currently unavailable" },
       400
     );
   }
   ```
2. **Default Gateway Fallback Check (`lines 68–82`):**
   If no specific gateway is passed in the request body:
   ```typescript
   const { data: defRow } = await supabaseAdmin
     .from("payment_gateways")
     .select("code, enabled, is_default")
     .eq("enabled", true)
     .eq("is_default", true)
     .maybeSingle();

   if (!defRow || !defRow.code) {
     return jsonResponse(
       { success: false, error: "No active payment gateway is currently configured" },
       400
     );
   }
   ```
3. **Server Secret & Key Guard (`lines 83–113`):**
   Before executing the checkout RPC or contacting the gateway, the Edge Function ensures required API keys exist in the environment:
   - **Razorpay:** `RAZORPAY_KEY_ID` & `RAZORPAY_KEY_SECRET`
   - **Cashfree:** `CASHFREE_CLIENT_ID` & `CASHFREE_CLIENT_SECRET`
   - **Easebuzz:** `EASEBUZZ_KEY` & `EASEBUZZ_SALT`
   If keys are absent, it voids the request with HTTP 503.

### Layer 2: PostgreSQL Database Transaction (`create_order_v2_app`)

Inside the database RPC (`04_offers_discount.sql:451-455`), an atomic check runs before rows or locks are generated:
```sql
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_gateways') THEN
  IF NOT EXISTS (SELECT 1 FROM public.payment_gateways WHERE code = v_gateway_code AND enabled = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Selected payment gateway is unavailable');
  END IF;
END IF;
```

---

## 3. Root Cause Analysis: Why the Client Gets Stuck in "Verifying Payment"

### Root Cause 1: Easebuzz SDK Outcome Is Overridden to `'return_to_app'`
In `PaymentProcessingScreen.js:993-1002`:
```javascript
const outcome = mapGatewaySdkResult(res.payload);
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  console.log('🎉 [Step 7/7] Easebuzz SDK result:', res.payload?.result, 'Outcome:', outcome);
}
// BUG: The parsed outcome is completely ignored!
applyOutcomeRef.current?.('return_to_app');
```
- When a user presses back or cancels in Easebuzz, the native SDK returns `result: "user_cancelled"` or `"back_pressed"`.
- `mapGatewaySdkResult` correctly classifies this as `'cancelled'`.
- **However, line 1002 unconditionally dispatches `'return_to_app'`**.
- In `applyCheckoutOutcome`, `'return_to_app'` executes:
  ```javascript
  setVerifying(true);
  refreshPaymentStatus();
  ```
  This immediately locks the screen in the spinning **"Verifying your payment…"** state.

### Root Cause 2: Order Stays in `pending_payment` and Is Ignored by Poller
- Since the user aborted payment, Easebuzz never fires a webhook.
- The `orders` record in Supabase remains in `status = 'pending_payment'`.
- In `applyOrderStatus(status)`:
  - `isOrderPlacedSuccessStatus('pending_payment')` is `false`.
  - `status === 'payment_cancelled'` is `false`.
  - `status === 'payment_failed'` is `false`.
- `applyOrderStatus` takes no action on `pending_payment`. It continues polling every 1.5 seconds while spinning for the entire 30-second window (`VERIFY_WINDOW_MS = 30000`) until it displays the "Verification Taking Longer" dialog.

### Root Cause 3: 35-Second `CHECKOUT_LAUNCH_GRACE_MS` Blocks Failure & Cancellation
In `PaymentProcessingScreen.js:731-740`:
```javascript
const inLaunchGrace = Date.now() - checkoutOpenedAtRef.current < CHECKOUT_LAUNCH_GRACE_MS; // 35000ms
if (
  inLaunchGrace &&
  (status === 'payment_failed' ||
    status === 'payment_cancelled' ||
    isCancelledLike(status))
) {
  return; // BUG: Swallows actual failed/cancelled statuses for 35 seconds!
}
```
- If an order is marked `payment_failed` or `payment_cancelled` within 35 seconds of entering checkout (standard for fast cancellations), **the client ignores the status and continues spinning**.
- Because the verification timeout is 30 seconds (`30000ms < 35000ms`), the 30-second warning alert fires *before* the cancel/fail state is ever honored.

### Root Cause 4: Header Missing Cancel/Back Navigation in Verification State
- In `PaymentProcessingScreen.js`, the header displays only a static `<Text>Checkout</Text>`.
- When in `verifying = true`, there is no button or escape hatch for the user.
- On iOS (which lacks hardware back navigation), the user is trapped until the 30-second alert triggers.

---

## 4. Comprehensive Gateway Scenario Audit

### Scenario Matrix: Coming Back With vs. Without Payment

| Gateway & Mode | Action / Event | Returned Payload / URL | Current System Behavior | Intended Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Easebuzz (Native SDK)** | **User cancels / taps back without paying** | `{ result: "user_cancelled" }` or `"back_pressed"` | ❌ Forces `'return_to_app'`, activates `verifying = true`, hangs for 30s, shows "Taking longer" alert. Leaves order in `pending_payment`. | Recognize `'cancelled'`, quick-verify DB isn't already paid, immediately cancel order and return to Cart. |
| **Easebuzz (Native SDK)** | **User completes payment** | `{ result: "payment_success" }` | ⚠️ Dispatches `'return_to_app'`, polls DB. Once webhook updates status to `preparing`/`placed`, navigates to Confirmation. | Dispatch `'success'`, set verifying, poll webhook, navigate to Confirmation. |
| **Easebuzz (Native SDK)** | **Payment fails (OTP fail, card decline)** | `{ result: "payment_failed" }` | ❌ Dispatches `'return_to_app'`, enters verifying. If backend marks `payment_failed`, it is ignored by 35s grace timer. | Verify for 3-4s (in case webhook settles as success); if still failed, show "Payment failed" alert and return to Cart. |
| **Easebuzz (WebView)** | **User cancels / taps back** | Redirects to `furl` or URL with cancel query params | ⚠️ If URL contains `easebuzz-webhook`, mapped to `'return_to_app'` and spins for 30s. | Intercept cancel parameters, return immediately to Cart. |
| **Easebuzz (WebView)** | **User completes payment** | Redirects to `surl` | ✅ Mapped to `'success'` or `'return_to_app'`, polls webhook and confirms. | Same (verified working). |
| **Cashfree (Native SDK)** | **User cancels / taps back** | `onError` with `isCashfreeUserCancelError` | ✅ Correctly calls `applyOutcome('cancelled')`, resets navigation to Cart immediately. | Working correctly. |
| **Cashfree (Native SDK)** | **User completes payment** | `onVerify` callback | ✅ Calls `applyOutcome('success')`, confirms order. | Working correctly. |
| **Cashfree (Native SDK)** | **Payment fails** | `onError` with failure details | ✅ Calls `applyOutcome('failure')`, displays "Payment failed" dialog. | Working correctly. |
| **Razorpay (Native SDK)** | **User dismisses / cancels** | `res.cancelled === true` | ✅ Calls `applyOutcome('cancelled')`, resets to Cart immediately. | Working correctly. |
| **Razorpay (Native SDK)** | **User completes payment** | Returns signature & payment ID | ✅ Verifies signature with backend, proceeds to Confirmation. | Working correctly. |
| **Razorpay (WebView)** | **User dismisses modal** | `modal.ondismiss` -> `hungertap://payment-cancel` | ✅ Deep link intercepted as `'cancelled'`, resets to Cart. | Working correctly. |

---

## 5. Remediation Plan

### Step 1: Fix Easebuzz Native SDK Callback Dispatch (`PaymentProcessingScreen.js`)
Replace unconditional `'return_to_app'` dispatch with outcome-aware handling:
```javascript
const outcome = mapGatewaySdkResult(res.payload);

if (outcome === 'cancelled') {
  // Quick safety check: ensure an async webhook hasn't already marked the order paid
  try {
    const { data: ord } = await supabase
      .from('orders')
      .select('status')
      .eq('id', checkoutOrderId)
      .eq('placed_by', userId)
      .maybeSingle();
    if (ord?.status && isOrderPlacedSuccessStatus(ord.status)) {
      finalizeSuccess();
      return;
    }
  } catch (_) {}
  applyOutcomeRef.current?.('cancelled');
  return;
}

if (outcome === 'success') {
  applyOutcomeRef.current?.('success');
  return;
}

if (outcome === 'failure') {
  // Check for 3-4 seconds to allow late-arriving webhooks before failing
  setVerifying(true);
  let settled = false;
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    if (finalizedRef.current) return;
    try {
      const { data: ord } = await supabase
        .from('orders')
        .select('status')
        .eq('id', checkoutOrderId)
        .eq('placed_by', userId)
        .maybeSingle();
      if (ord?.status && isOrderPlacedSuccessStatus(ord.status)) {
        settled = true;
        finalizeSuccess();
        return;
      }
    } catch (_) {}
  }
  if (!settled && !finalizedRef.current) {
    finalizeFailure();
  }
  return;
}

applyOutcomeRef.current?.('return_to_app');
```

### Step 2: Restrict `CHECKOUT_LAUNCH_GRACE_MS`
Do not suppress `payment_failed` or `payment_cancelled` once checkout has already been presented (`sdkUiPresentedRef.current === true`) or when the gateway returns a result:
```javascript
const inLaunchGrace = !sdkUiPresentedRef.current && (Date.now() - checkoutOpenedAtRef.current < 8000);
```

### Step 3: Add Cancellation Capability in Verification UI
When in the `verifying` state, display a discreet "Cancel and return to cart" button after a short threshold (e.g., 5 seconds) so users are never trapped if a network hiccup or unhandled gateway drop occurs.
