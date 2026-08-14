# Payment SDK & Fallback Architecture

This document describes the payment orchestration, runtime capability detection, native SDK integration, error classification, and fallback mechanisms in the HungerTap mobile application.

---

## 1. End-to-End Flowchart

```mermaid
flowchart TD
    classDef startEnd fill:#1e293b,stroke:#94a3b8,stroke-width:2px,color:#fff
    classDef decision fill:#334155,stroke:#38bdf8,stroke-width:2px,color:#fff
    classDef nativeSdk fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#fff
    classDef webFallback fill:#78350f,stroke:#fbbf24,stroke-width:2px,color:#fff
    classDef verify fill:#312e81,stroke:#818cf8,stroke-width:2px,color:#fff
    classDef errCancel fill:#7f1d1d,stroke:#f87171,stroke-width:2px,color:#fff

    Start(["User Taps Place Order"]) --> CreateOrder["Call Edge Function: postCreateOrderV2()"]
    CreateOrder --> OrderResp{"Order & Session Created?"}
    OrderResp -- No --> ShowCartErr["Alert Error & Stay in Cart"]:::errCancel
    OrderResp -- Yes --> NavProcessing["Navigate to PaymentProcessingScreen"]

    subgraph ModeResolution ["1. Runtime Capability & Mode Probing"]
        NavProcessing --> GatewayCheck{"Gateway Type?"}:::decision
        
        GatewayCheck -- Cashfree --> CFProbe{"Native Module Registered?<br/>NativeModules / TurboModule"}:::decision
        CFProbe -- Yes --> CFModeSDK["Mode = CASHFREE_SDK"]:::nativeSdk
        CFProbe -- No (Expo Go / Missing) --> CFModeWeb["Mode = CASHFREE_WEBVIEW"]:::webFallback
        
        GatewayCheck -- Easebuzz --> EBProbe{"Native Module Registered?<br/>EasebuzzSdk"}:::decision
        EBProbe -- Yes --> EBModeSDK["Mode = EASEBUZZ_SDK"]:::nativeSdk
        EBProbe -- No --> EBModeWeb["Mode = EASEBUZZ_WEBVIEW"]:::webFallback
    end

    subgraph NativeExecution ["2. Native SDK Execution & Fallback Decision"]
        CFModeSDK --> CFLaunch["startCashfreeCheckout()<br/>Launch CFDropCheckoutPayment"]:::nativeSdk
        EBModeSDK --> EBLaunch["startEasebuzzCheckout()<br/>Launch Native Easebuzz UI"]:::nativeSdk
        
        CFLaunch --> CFTimer["30s Fallback Timer (useGatewayLaunchFallback)"]
        EBLaunch --> EBTimer["30s Fallback Timer"]
        
        CFLaunch -- "Throws Exception" --> FallbackCFWeb["Trigger switchToCashfreeWebViewFallback()"]:::webFallback
        CFTimer -- "30s Timeout (UI never surfaced)" --> FallbackCFWeb
        EBTimer -- "30s Timeout" --> FallbackEBWeb["Trigger switchToEasebuzzWebViewFallback()"]:::webFallback
        EBLaunch -- "launchFailed = true" --> FallbackEBWeb

        CFLaunch --> CFCallbacks{"SDK Callback"}:::decision
        CFCallbacks -- "onVerify(orderId)" --> VerifyingState["Verifying = true<br/>(Show spinner & poll status)"]:::verify
        CFCallbacks -- "onError(error)" --> CFErrorCheck{"isCashfreeUserCancelError()?"}:::decision
        
        CFErrorCheck -- "User Cancelled / Back Press" --> CancelOrder["Finalize Cancel<br/>(Do NOT reopen WebView)"]:::errCancel
        CFErrorCheck -- "Launch / Session Error" --> FallbackCFWeb

        EBLaunch --> EBResult{"SDK Result"}:::decision
        EBResult -- "success" --> VerifyingState
        EBResult -- "user_cancelled / back_press" --> CancelOrder
        EBResult -- "failure / error" --> FallbackEBWeb
    end

    subgraph WebViewFallback ["3. Hosted WebView / JS SDK Fallback"]
        FallbackCFWeb --> CFSessionCheck{"Reusable payment_session_id?"}:::decision
        CFSessionCheck -- Yes --> LoadCFWeb["Render Cashfree Web JS SDK HTML<br/>(sdk.cashfree.com/js/v3/cashfree.js)"]:::webFallback
        CFSessionCheck -- No --> RefreshSession["refreshCheckoutSessionForWebView()<br/>Cancel old + wait cooldown + fresh session"]:::webFallback
        RefreshSession --> LoadCFWeb
        
        CFModeWeb --> LoadCFWeb
        
        FallbackEBWeb --> LoadEBWeb["Load Server-issued activePaymentUrl in WebView"]:::webFallback
        EBModeWeb --> LoadEBWeb

        LoadCFWeb --> WVIntercept{"WebView Request / Deep Link"}:::decision
        LoadEBWeb --> WVIntercept
        
        WVIntercept -- "UPI / External App Scheme<br/>(upi:, gpay:, phonepe:, intent:)" --> OpenExt["Linking.openURL(url)<br/>Handoff to UPI App"]
        WVIntercept -- "Payment Return URL<br/>(hungertap://payment-return)" --> ParseOutcome{"parsePaymentReturnUrl()"}:::decision
        
        ParseOutcome -- "success / return_to_app" --> VerifyingState
        ParseOutcome -- "cancelled" --> CancelOrder
        ParseOutcome -- "failure" --> FailOrder["Finalize Failure"]:::errCancel
    end

    subgraph Verification ["4. Status Verification & Settlement"]
        VerifyingState --> FastPoll["Fast Polling (every 500ms for up to 30s)"]:::verify
        BackgroundPoll["Background Polling (every 2.5s)"]:::verify
        Webhook["Cashfree / Easebuzz Backend Webhook"] --> DB[(Supabase 'orders' table)]

        FastPoll --> CheckDB{"Order status == 'placed' / 'paid'?"}:::decision
        BackgroundPoll --> CheckDB
        DB -.-> CheckDB

        CheckDB -- Yes --> Success["finalizeSuccess()<br/>Clear Cart & Navigate to OrderConfirmation"]:::startEnd
        CheckDB -- Cancelled --> CancelOrder
        CheckDB -- Failed --> FailOrder
        CheckDB -- Timeout (30s) --> StuckNotice["Alert 'Verification Taking Longer'<br/>Direct to My Orders"]
    end
```

---

## 2. Sequence Diagram (Native SDK vs. Fallback vs. Webhook)


## 3. Architecture & Implementation Details

### 3.1 Lazy Probing Without Crashing in Expo Go
- **File**: [`lib/cashfreeCheckout.js`](../lib/cashfreeCheckout.js) and [`lib/easebuzzCheckout.js`](../lib/easebuzzCheckout.js)
- **Problem**: In React Native / Expo, calling `require('react-native-cashfree-pg-sdk')` or `require('react-native-easebuzz-sdk')` in runtimes lacking the compiled native binary (such as standard Expo Go or unlinked dev builds) causes fatal factory crashes at startup.
- **Solution**: The app probes `NativeModules` and `TurboModuleRegistry` first before executing any lazy `require()`. If absent, it safely reports unavailable and switches to the WebView mode.

### 3.2 Session Reuse Over Order Re-creation
- **File**: [`screens/PaymentProcessingScreen.js`](../screens/PaymentProcessingScreen.js)
- **Problem**: Re-creating an order on fallback creates duplicate pending orders and immediately triggers the backend rate limiter (`enforce_order_rate_limits`: 5s order cooldown).
- **Solution**: The existing `payment_session_id` issued by `create-order-v2` is passed directly into Cashfree's Web JS SDK (`sdk.cashfree.com/js/v3/cashfree.js`) inside an inline HTML shell, reusing the identical checkout session without creating a new order.

### 3.3 Smart Cancellation vs. Launch Failure Classification
- **Function**: `isCashfreeUserCancelError(error)` in [`lib/cashfreeCheckout.js`](../lib/cashfreeCheckout.js)
- **Classification**:
  - If error contains `cancel`, `user_dropped`, `back_press`, or `aborted`: The user deliberately backed out. Checkout finalizes as cancelled and returns to the cart.
  - If error is a technical launch/session fault: Seamlessly activates `switchToCashfreeWebViewFallback()` to ensure the user can still pay.

### 3.4 30-Second Watchdog Timer
- **Hook**: `useGatewayLaunchFallback()` in [`screens/PaymentProcessingScreen.js`](../screens/PaymentProcessingScreen.js)
- If native checkout fails to present its UI within 30 seconds without emitting an explicit error callback, the watchdog timer fires and automatically switches to the WebView fallback.

### 3.5 External UPI App Scheme Interception
- **Function**: `onShouldStartLoadWithRequest()` in [`screens/PaymentProcessingScreen.js`](../screens/PaymentProcessingScreen.js)
- Deep links targeting external payment apps (`upi://`, `intent://`, `gpay://`, `phonepe://`, `paytmmp://`, `bhim://`, `credpay://`) are intercepted and handed over to the OS using React Native's `Linking.openURL()`.

### 3.6 Authoritative Status Reconciliation
- **Webhook**: [`supabase_edge_function_cashfree_webhook_v2.ts`](../supabase_edge_function_cashfree_webhook_v2.ts)
- While client callbacks provide immediate optimistic feedback, final order confirmation is strictly derived from the PostgreSQL `orders` table via polling (`POLL_MS = 2500ms` background, and `500ms` fast verification polling).
