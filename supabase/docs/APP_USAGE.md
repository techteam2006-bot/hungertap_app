# HungerTap Student App ↔ Supabase

**App:** `hungertap_app` (Expo / React Native)  
**Auth:** Supabase Auth email/password + JWT (`authenticated` role)  
**Doc date:** 2026-08-25

---

## 1. How the app talks to Supabase

| Path | When |
|------|------|
| Direct table / view (`.from`) | Profile, menu, canteen status, FCM tokens, colleges name |
| RPC (`.rpc`) | Order history page, force-update version, account soft-delete/restore, signup checks |
| Edge Function (`functions.invoke` / fetch) | **Create order + payment checkout** (`create-order-v2`), OTP signup |

The app never uses `service_role`. Order creation goes through Edge so gateway secrets stay server-side.

---

## 2. Critical flows

### Force update
- RPC: `get_minimum_supported_app_version(p_platform)`
- Reads `colleges.min_app_version` for the signed-in user’s college
- UI: `ForceUpdateGate` / `appVersionCheck.js`
- Fail-open on network errors

### Order history (Orders tab)
- RPC: `list_my_orders_page` → headers from live + `archived_*` + `failed_*`
- Then `.from('order_items' | archived | failed lines)` for line items
- **Grant check (2026-08-25):** `authenticated` **can** EXECUTE; `anon` cannot  
  → Revoking anon does **not** break history. App must be signed in (it already is).

### Place order
1. Edge `create-order-v2` (JWT verified)
2. Admin client inside Edge calls `create_order_v2_app` → token from `generate_daily_order_token_v2` (now **counter table**)
3. Payment row `initiated` + gateway session
4. Webhooks call `apply_payment_success` / void paths

### Menu & canteen
- Prefer views: `z_menu_for_canteen`, `z_active_open_canteens`
- Fallback: `items`, `categories`, `canteens`
- College name: join `users → colleges` or `.from('colleges')` (own college via RLS)

### Push
- Upsert `user_tokens` (FCM)
- Server inserts `notifications` → trigger → `hyper-function` push

### Account
- `create_user_profile_from_auth`, `email_already_registered`
- `soft_delete_own_account` / `restore_own_account`

---

## 3. Tables / views the app reads or writes

| Object | Access pattern |
|--------|----------------|
| `users` | SELECT own; UPDATE `canteen_id` (switcher), profile fields |
| `colleges` | SELECT own college name |
| `canteens` | SELECT college canteens / open status |
| `categories` / `items` / `z_menu_for_canteen` | Menu |
| `z_active_open_canteens` | Switcher |
| `orders` / `order_items` | Live status screens; confirmation |
| `archived_*` / `failed_*` | History lines (via RLS select policies) |
| `payment_gateways` | List selectable gateways |
| `user_tokens` | FCM register/unregister |
| `notifications` | Inbox (if used) |

Client **cannot** write `payments` / `refunds` (deny-all policies). Money mutations are Edge + DEFINER RPCs.

---

## 4. RPCs used by the app

| RPC | Purpose |
|-----|---------|
| `list_my_orders_page` | Paged order history |
| `get_minimum_supported_app_version` | Force update |
| `create_user_profile_from_auth` | Post-signup profile |
| `email_already_registered` | Signup UX |
| `soft_delete_own_account` / `restore_own_account` | Account deletion window |
| `claim_user_push_token` | (if wired) FCM claim |

Order create RPCs are called from **Edge**, not directly from the JS client.

---

## 5. Realtime

App may subscribe to `orders` / `canteens` / related channels for live status (see `NotificationService`, payment screens). Policies must allow SELECT on subscribed rows.

---

## 6. What recent backend changes mean for the app

| Change | App impact |
|--------|------------|
| Token counter (C) | None visible — faster token under load; still returns string token |
| Indexes (A) | Faster college/canteen filters — transparent |
| Revoke anon on `list_my_orders_page` | **No break** if user is logged in |
| Stock-after-payment (`02` pending) | Would change when items go OOS relative to unpaid carts — **not live** |
| Razorpay (`03`) | Already selectable if enabled; default remains Cashfree |

---

## 7. Key source files

- `lib/createOrderV2.js`, `lib/cartCheckout.js` — checkout
- `lib/orderQueries.js` — history RPC
- `lib/appVersionCheck.js` — force update
- `lib/AuthContext.js` — auth + profile RPCs
- `lib/CanteenStatusService.js` — open/closed
- `screens/OrdersScreen.js`, `HomeScreen.js`, `PaymentProcessingScreen.js`
