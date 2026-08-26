# HungerTap Supabase — Overview

**Project:** `mgyfyutxtapgggcwkknw`  
**Region:** ap-south-1 (India)  
**Doc date:** 2026-08-25  
**Schema dump:** `../supabase_schema_latest.sql` (partial live sync; full `pg_dump` needs project-owner CLI)

---

## 1. What this backend is for

HungerTap is a college canteen ordering system:

```
colleges → canteens → items / orders / users
categories → items
orders → order_items
orders ↔ payments → refunds
```

- **Hot path:** live `orders`, `order_items`, `payments`, `refunds`
- **Cold path:** after canteen close → `archived_*` (fulfilled/cancelled) or `failed_*` (payment failed)
- **Midnight IST:** `purge_terminal_payment_rows()` copies orphans then deletes terminal live payments/refunds

---

## 2. Core tables (22 public + 1 private)

| Area | Tables |
|------|--------|
| Org | `colleges`, `canteens`, `users` |
| Menu | `categories`, `items` |
| Live orders | `orders`, `order_items` |
| Money | `payments`, `refunds`, `payment_gateways`, `payment_webhook_events` |
| History | `archived_orders`, `archived_order_items`, `archived_payments`, `archived_refunds`, `failed_orders`, `failed_order_items` |
| Ops | `canteen_close_jobs`, `canteen_daily_token_counters`, `notifications`, `user_tokens`, `system_error_logs` |
| Private | `private.hungertap_config` (secrets / project URL; service_role only) |

All public tables have **RLS enabled**. Clients use `authenticated` JWT; Edge/webhooks use `service_role`.

---

## 3. Read models (`z_*` views)

| View | Purpose |
|------|---------|
| `z_menu_for_canteen` | Menu + category fields |
| `z_active_open_canteens` | Open canteens for switcher |
| `z_kitchen_queue` | Open kitchen lines |
| `z_cds_aggregated_items` | CDS totals by item |
| `z_student_order_feed` | Live + archived + failed headers |
| `z_canteen_day_sales` | Delivered revenue by token_date |
| `z_order_payment_summary` | Latest payment per order (service-oriented) |
| `z_refunds_due` | Scheduled refunds due |
| `z_user_inbox` | Notifications inbox |

Views use `security_invoker` — underlying table RLS still applies.

---

## 4. Money & close lifecycle

1. Student checkout → Edge `create-order-v2` → RPC `create_order_v2_app` → payment `initiated`
2. Gateway webhook → `apply_payment_success` → kitchen status
3. Admin sets `canteens.is_open = false` → trigger enqueues `canteen_close_jobs`
4. Cron every minute → `run_canteen_close_job` → `close_canteen_cleanup` (archive orders; **copy** payments; do **not** delete live payments)
5. Midnight IST (`0 18 * * *` UTC) → `purge_terminal_payment_rows`

### Crons (live)

| Job | Schedule | Command |
|-----|----------|---------|
| Expire stuck payments | `*/2 * * * *` | `expire_stale_payments()` |
| Close jobs | `* * * * *` | `run_canteen_close_job` (pending) |
| Promote refunds | `* * * * *` | `promote_scheduled_refunds()` |
| Purge soft-deleted users | `30 18 * * *` | `invoke_purge_deleted_users()` |
| Purge terminal payments | `0 18 * * *` | `purge_terminal_payment_rows()` |
| pg_net cleanup | `15 * * * *` | delete `net._http_response` older than **7 days** |

### Payment gateways (live)

| Code | Enabled | Default |
|------|---------|---------|
| cashfree | yes | **yes** |
| easebuzz | yes | no |
| razorpay | yes | no |

---

## 5. Lunch-peak / reliability changes (status)

File: `../BACKEND_CHANGES_DO_NOT_APPLY_YET.sql`

| Change | Status | Notes |
|--------|--------|-------|
| **A** FK indexes (`users.canteen_id`, `canteens.college_id`) | **Done** | Already on live |
| **B** Revoke EXECUTE on trigger helpers; revoke anon from `list_my_orders_page` | **Done** | `authenticated` still has EXECUTE → student order history OK |
| **C** `canteen_daily_token_counters` + new `generate_daily_order_token_v2` | **Done (2026-08-25)** | Replaces advisory lock + MAX scan |
| **D** Harden `notify_push_on_notification` | **Done (2026-08-25)** | 2s enqueue timeout + EXCEPTION; push never fails order write |
| **E** Hourly `net._http_response` cleanup cron | **Done (2026-08-25)** | Keep **7 days**; job `hungertap-cleanup-pg-net` |
| **F** Pro / backups / leaked-password | User after Pro | Dashboard |

---

## 6. Token counter (Change C) — what it does

**Before:** every order took `pg_advisory_xact_lock` and scanned live + archived + failed for `MAX(token)`.

**After:** table `canteen_daily_token_counters (canteen_id, token_date, next_token)`:
1. First call of the day seeds from max across those tables
2. Later calls: single atomic `UPDATE next_token = next_token + 1`

Called only from order-create path (`service_role` / DEFINER). No client grants.

---

## 7. Push + pg_net (Change D / E) — explained

### Harden `notify_push_on_notification` (D) — **applied 2026-08-25**

**What the timeout is:** `pg_net.http_post` does **not** wait for FCM to reach the phone. It only waits until Supabase accepts the outbound HTTP call into its queue. Old value **5000ms** was a generous ceiling; it did not mean “push takes 5 seconds.”

**Now:** 2000ms + `EXCEPTION` handler. If enqueue fails, write a WARNING and still `RETURN NEW` so the notification (and parent order) commits.

### Hourly `net._http_response` cleanup (E) — **applied 2026-08-25**

Every `net.http_post` leaves a row in `net._http_response`. Cron `hungertap-cleanup-pg-net` runs at `:15` each hour and deletes rows older than **7 days**. No app behavior change.

---

## 8. `migrations_pending/` SQL — explain (do not blind-apply)

### `colleges` RLS — **tightened 2026-08-25**

- SELECT: own college via `get_my_college_id()` **and** `is_deleted IS NOT TRUE`
- INSERT/UPDATE/DELETE: explicit deny for `authenticated`/`anon`
- Grants: `authenticated` **SELECT only**; writes via `service_role` / SQL


**Intent:** every refund (live + archived) knows which gateway to call for retries.

**Applied safely (not the stale file):**
- Backfilled `archived_refunds.gateway_name` from payments
- Patched `close_canteen_cleanup` copy → `archived_refunds` to include `gateway_name`
- Did **not** rewrite whole close function / did **not** use `archieved_*`

### `02_stock_after_payment.sql` — **already live**

Students soft-check at create; stock deducts on payment success (OOS → scheduled refund). Admin still reserves at create. File marked superseded; do not re-apply (would risk regressing restore trigger).

### `03_razorpay_create_order.sql` — **already live (skipped)**

Razorpay seeded; `create_order_v2_app` fail-closed. No apply needed.

Other files under `migrations_pending/` (`_deploy_payloads`, `_extracted_*`, chunks) are Edge scratch — not DB migrations.

---

## 9. Edge functions (inventory only)

Active on live include: `create-order-v2`, payment webhooks (Cashfree / Easebuzz / Razorpay), `retry-refund`, `verify-razorpay-payment`, `sync-canteen-cache`, `get-canteen-menu`, `hyper-function` (push), `send-signup-otp`, `process-canteen-close`, `process-close-refunds`, `purge-deleted-users`, food-copy helpers.

Details: app/web usage docs.

---

## 10. Optional after Pro plan

1. Enable **Auth → Leaked password protection**
2. Confirm **daily backups**
3. Raise compute if lunch CPU pegs
4. Re-run full `supabase db dump --project-ref mgyfyutxtapgggcwkknw` as project owner to replace this partial dump

---

## 11. Related docs

- [APP_USAGE.md](./APP_USAGE.md) — student Expo app
- [WEB_USAGE.md](./WEB_USAGE.md) — canteen web / sub-counter
