# HungerTap Menu Cache — Architecture Report

## 1. Architecture diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Screens (HomeScreen, CartScreen)                           │
│       │ getMenu / getMenuPage                               │
│       ▼                                                     │
│  lib/menuCache.js                                           │
│  ┌──────────────┐   miss/stale    ┌───────────────────────┐ │
│  │ Memory Map   │ ───────────────►│ AsyncStorage          │ │
│  │ per canteen  │ ◄───────────────│ menu_cache_<id>       │ │
│  └──────────────┘   hydrate       │ menu_cache_index      │ │
│         │                         └───────────────────────┘ │
│         │ no usable cache / forceRefresh                    │
│         ▼                                                   │
│  foodService.getAllItems → Edge / HTTP menu (unchanged)     │
└─────────────────────────────────────────────────────────────┘
```

## 2. Request flow

1. Caller invokes `getMenu(canteenId)` or `getMenuPage(...)`.
2. Normalize canteen id (`_all` when null).
3. If fresh **memory** hit → return.
4. Else read **AsyncStorage** `menu_cache_<canteenId>`.
5. If fresh → hydrate memory → return.
6. If **stale** → return stale immediately + `scheduleBackgroundRefresh`.
7. If **miss** (or `forceRefresh`) → single-flight network via `foodService.getAllItems`.
8. On success → write memory + AsyncStorage + index → notify subscribers.
9. On failure → return any cache; if none → throw.

## 3. Memory cache flow

- `Map<string, MenuCacheEntry>` keyed by normalized canteen id.
- Always checked first.
- Hydrated from AsyncStorage on disk hits.
- Soft-invalidated by setting `expiresAt: 0` (data kept for offline).

## 4. AsyncStorage flow

| Key | Purpose |
|-----|---------|
| `menu_cache_<canteenId>` | Full entry per canteen |
| `menu_cache_index` | `["1","5","20"]` for cleanup |
| `menu_cache_last_canteen` | Last canteen for offline Home startup |
| `menu_cache` (legacy) | Migrated once then removed |

Entry shape:

```json
{
  "version": 1,
  "canteenId": "5",
  "updatedAt": 1681234567,
  "expiresAt": 1681239999,
  "itemCount": 42,
  "menuHash": "abcdef",
  "menuVersion": null,
  "backendUpdatedAt": null,
  "data": []
}
```

`menuVersion` / `backendUpdatedAt` are populated when the network result exposes them (future-compatible).

## 5. Offline flow

- Cached menu → always returned; never throws.
- No cache → throws `MENU_OFFLINE_NO_CACHE` / fetch error.
- Home restores `menu_cache_last_canteen` so browsing can start before college switcher network returns.
- Canteen status / switcher failures do not block startup (`menuCanteenReady` unblocked from cache).

## 6. Background refresh flow

```
Stale hit → return data → CACHE REFRESH STARTED
         → network (deduped)
         → success: memory + storage + subscribeMenuUpdates / onUpdate
         → failure: keep stale; log CACHE REFRESH FAILED
```

UI never waits on background refresh.

## 7. Cache invalidation flow

- `invalidateMenu(id)` — soft expire (offline fallback kept).
- `clearMenuCache(id)` — hard delete one canteen.
- `clearAllMenuCache()` — wipe memory, keys, index.
- Pull-to-refresh: soft invalidate + `getMenuPage(..., { forceRefresh: true })`.

## 8. Cleanup flow

`cleanupExpiredCaches()` (once per session on first `getMenu`, and from DEV panel):

- Drop entries older than **24h** and not fresh.
- Remove orphaned `menu_cache_*` keys.
- Repair `menu_cache_index`.
- Remove legacy `menu_cache`.

## 9. Files modified

| File | Change |
|------|--------|
| `lib/menuCache.js` | Full offline-first multi-canteen cache |
| `screens/HomeScreen.js` | `getMenuPage` + subscribe + last-canteen restore |
| `screens/CartScreen.js` | `getMenu` + offline canteen fallback + `onUpdate` |
| `App.js` | DEV `MenuCacheDebugPanel` |
| `components/MenuCacheDebugPanel.js` | **New** DEV inspector |
| `lib/AuthContext.js` | Profile sync timeout 15s → 8s (faster offline fail-open) |

## 10. Screens now using cache

| Screen | API |
|--------|-----|
| HomeScreen | `getMenuPage` → `getMenu` |
| CartScreen | `getMenu` (recommendations) |

## 11. Screens / paths still bypassing cache

| Location | Reason |
|----------|--------|
| `foodService.getFoodItem(id)` (ItemDetail) | Single-item fetch; not full menu |
| `foodService.getCategories` | Separate categories cache |
| `foodService.getFoodItems` / `getFoodItemsPage` | Low-level transport; screens no longer call these for list UI |
| Canteen switcher / status queries | Not menu payloads |
| Auth / cart / orders | Unrelated domains |

## 12. Potential remaining limitations

1. **First install offline** — no cache → menu empty with error UI (expected).
2. **Guest menu** (`canteenId` null) — edge requires `canteen_id`; guest path unchanged.
3. **Backend `menuVersion`** — client stores fields when present; server does not send them yet.
4. **Realtime availability** — still live updates when online; offline uses cached availability.
5. **Categories / college switcher** — still network for picker list; last canteen name/id is enough to browse offline.
6. **Profile role gate** — if offline profile sync fails, `userRole` may be null and Navigation may treat user as guest until online (pre-existing auth model).

## Consumer migration report

| File | Previous | Updated |
|------|----------|---------|
| `screens/CartScreen.js` | `getMenu(canteenId)` (already cached, single global key) | `getMenu` + last-canteen fallback + `onUpdate` |
| `screens/HomeScreen.js` | `foodService.getFoodItemsPage` (edge 45s memory only) | `getMenuPage` (durable multi-canteen cache) |
| `lib/menuCache.js` | Single `menu_cache` + one memory slot | Per-canteen Map + index + SWR + dedupe |

## Public helpers

`getMenu`, `refreshMenu`, `invalidateMenu`, `clearMenuCache`, `clearAllMenuCache`, `getCachedCanteens`, `cleanupExpiredCaches`, `preloadMenu`, `getMenuPage`, `subscribeMenuUpdates`, `rememberLastCanteen`, `getLastRememberedCanteen`, `getMenuCacheDebugSnapshot`.

## DEV logging (`__DEV__` only)

`CACHE HIT (Memory|AsyncStorage)`, `CACHE MISS`, `CACHE STALE`, `CACHE REFRESH STARTED|SUCCESS|FAILED`, `CACHE SAVED`, `CACHE INVALIDATED`, `CACHE CLEANUP`, `NETWORK REQUEST`, `OFFLINE CACHE USED`, `NO CACHE AVAILABLE`.
