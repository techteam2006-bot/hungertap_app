# HungerTap Web (Canteen) ↔ Supabase

**Apps:** `canteenWeb-loki` (primary kitchen/admin web), `hungertap_subCounter` (sub-counter / similar stack)  
**Auth:** Supabase Auth — role `canteen_admin` (JWT `authenticated`)  
**Doc date:** 2026-08-25

---

## 1. How the web talks to Supabase

| Path | When |
|------|------|
| Direct `.from` | Menu CRUD, canteen open/close, live orders, archived past orders |
| RPC | Kitchen ready FIFO, status update/revert, cancel refunds, revenue, CDS |
| Edge `functions.invoke` | AI food copy / preview (`generate-food-copy`, `generate-food-preview`) |

Web uses the **anon key + user session** (not service_role in the browser). Counter/admin place-order may call RPC `create_order_v2` (DEFINER) for walk-in / counter orders.

---

## 2. Critical flows

### Login & canteen scope
- Load `users` → `canteen_id`, `role`
- Load `canteens` (+ `colleges` name for header)
- All kitchen mutations scoped to that canteen (RLS + RPC checks)

### Kitchen / CDS
- Live: `orders` + `order_items` (status preparing / partially_ready / ready)
- Aggregates: RPC `get_cds_aggregated_items` or view `z_cds_aggregated_items`
- Mark ready: RPC `allocate_ready_count_fifo` and/or `update_order_status_flexible`
- QR deliver: `update_order_status_flexible` → delivered

### Counter place order
- RPC `create_order_v2` (admin path → preparing, stock reserved at create)
- Print barcode via `get_order_barcode_for_reprint`

### Canteen close
- UPDATE `canteens.is_open = false` (restricted columns via trigger)
- Trigger enqueues `canteen_close_jobs`
- Backend cron runs cleanup (archive); web may call `ensure_refund_for_order` for edge cases

### Revenue / past orders
- RPC `get_delivered_revenue_aggregate`
- Views `z_canteen_day_sales`
- Tables `archived_orders` / `archived_order_items` (+ live delivered while still hot)
- Revert helpers: `revert_order_status_v2`, `revert_delivered_past_order` (if present on live)

### Menu management
- `items`, `categories`, `item_categories` (junction if used)
- Stock / availability toggles; triggers sync `is_available` from stock
- Cache sync trigger → Edge `sync-canteen-cache` for CDN/menu cache

---

## 3. Tables / views the web uses

| Object | Typical use |
|--------|-------------|
| `users` | Admin identity + canteen_id |
| `canteens` | Open/close, takeaway, auto_ready, app_orders_enabled |
| `colleges` | Display name |
| `categories` / `items` | Menu CRUD |
| `orders` / `order_items` | Kitchen board, QR, counter |
| `archived_*` | Past orders / history after close |
| `z_kitchen_queue`, `z_cds_aggregated_items`, `z_canteen_day_sales` | Dashboards |
| `cart_items` | Some counter cart UX (legacy in places — confirm before relying) |

Web does **not** directly mutate `payments` / `refunds` (RLS deny). Refunds go through RPCs / Edge retry.

---

## 4. RPCs used by the web

| RPC | Purpose |
|-----|---------|
| `create_order_v2` | Counter / admin place order |
| `allocate_ready_count_fifo` | CDS mark-ready allocation |
| `update_order_status_flexible` | Status transitions / QR deliver |
| `revert_order_status_v2` | Undo status |
| `cancel_order_by_admin` / `ensure_refund_for_order` | Cancel + refund |
| `get_cds_aggregated_items` | CDS totals |
| `get_delivered_revenue_aggregate` | Sales reports |
| `get_order_barcode_for_reprint` | Reprint |

---

## 5. What recent backend changes mean for the web

| Change | Web impact |
|--------|------------|
| Token counter (C) | Counter orders get tokens faster under lunch peak — same API |
| Indexes (A) | Faster user/canteen joins — transparent |
| Midnight payment purge | Live `payments` stay lean; archived copies remain for audit |
| Archive rename `archived_*` | Use **`archived_*` only** — never `archieved_*` |
| Stock-after-payment (`02` pending) | Affects **student** app path mainly; counter admin still reserves at create in that design |
| Razorpay (`03`) | Student app gateways; counter `create_order_v2` often unpaid/admin path |

---

## 6. Soft-deleted canteens note (live check 2026-08-25)

Live canteens `DEVDEE` and `testing` were both `is_deleted = true` at last check. Soft-delete college (`handle_close_college`) also marks canteens deleted. Re-activate via SQL/`service_role` if kitchens appear empty in the UI.

---

## 7. Key source files

**canteenWeb-loki**
- `src/App.jsx` — main kitchen UI, orders, menu
- `src/components/ManageOrders.jsx` — FIFO ready
- `src/components/QRScanPage.jsx`, `SimpleQRModal.jsx` — deliver
- `src/contexts/CanteenStatusContext.jsx` — open/close + refunds
- `src/lib/zViewQueries.js`, `deliveredRevenueApi.js`, `revertOrderApi.js`

**hungertap_subCounter** — parallel patterns under `src/` (same RPCs/views).
