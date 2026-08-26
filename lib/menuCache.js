/**
 * Offline-first multi-canteen menu cache.
 *
 * Hierarchy: Memory Map → AsyncStorage (per canteen) → network (`foodService.getAllItems`).
 * Stale entries are returned immediately while a background refresh runs.
 * Do not change menu API contracts or UI consumers' data shape — only caching.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { foodService } from './supabase';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Envelope schema version (client-side). Bump when entry shape changes incompatibly. */
const CACHE_ENTRY_VERSION = 1;

/** Fresh TTL — matches prior single-key cache (10 minutes). */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Expired entries older than this are removed by cleanup. */
const CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const INDEX_KEY = 'menu_cache_index';
const LEGACY_STORAGE_KEY = 'menu_cache';
const LAST_CANTEEN_KEY = 'menu_cache_last_canteen';

/** Prefix for per-canteen AsyncStorage keys: `menu_cache_<canteenId>`. */
const STORAGE_KEY_PREFIX = 'menu_cache_';

/** Scope used when canteenId is null/empty (guest / unscoped fetch). */
const UNSCOPED_ID = '_all';

// ─── Types (JSDoc) ───────────────────────────────────────────────────────────

/**
 * @typedef {object} MenuCacheEntry
 * @property {number} version
 * @property {string} canteenId
 * @property {number} updatedAt
 * @property {number} expiresAt
 * @property {number} itemCount
 * @property {string} menuHash
 * @property {unknown[]} data
 * @property {string|number|null} [menuVersion] - Optional backend version when exposed later
 * @property {number|null} [backendUpdatedAt] - Optional backend updatedAt when exposed later
 */

/**
 * @typedef {object} GetMenuOptions
 * @property {boolean} [forceRefresh]
 * @property {(data: unknown[]) => void} [onUpdate] - Called when a background refresh finishes
 */

/**
 * @typedef {object} GetMenuResult
 * @property {unknown[]} data
 * @property {null} error
 * @property {boolean} [fromCache]
 * @property {boolean} [stale]
 */

// ─── Memory + concurrency ────────────────────────────────────────────────────

/** @type {Map<string, MenuCacheEntry>} */
const memoryCache = new Map();

/** In-flight network fetches keyed by canteen scope — request deduplication. */
/** @type {Map<string, Promise<{ data: unknown[]|null, error: unknown|null, meta?: object }>>} */
const inflightNetwork = new Map();

/** Background refresh promises (separate from blocking fetches). */
/** @type {Map<string, Promise<void>>} */
const inflightBackground = new Map();

/** @type {Map<string, Set<(data: unknown[], entry: MenuCacheEntry) => void>>} */
const subscribers = new Map();

/** Run cleanup at most once per JS session unless forced. */
let cleanupRanThisSession = false;

/** @type {Map<string, 'idle'|'refreshing'|'success'|'failed'>} */
const backgroundStatus = new Map();

// ─── Dev logging ─────────────────────────────────────────────────────────────

/** @param {string} event @param {Record<string, unknown>} [extra] */
function cacheLog(event, extra) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (extra && Object.keys(extra).length) {
    console.log(`[MenuCache] ${event}`, extra);
  } else {
    console.log(`[MenuCache] ${event}`);
  }
}

// ─── Key helpers ─────────────────────────────────────────────────────────────

/** @param {string|null|undefined} canteenId */
export function normalizeCanteenId(canteenId) {
  if (canteenId == null || canteenId === '') return UNSCOPED_ID;
  return String(canteenId);
}

/** @param {string} canteenIdNormalized */
function storageKeyFor(canteenIdNormalized) {
  return `${STORAGE_KEY_PREFIX}${canteenIdNormalized}`;
}

/** @param {string|null|undefined} canteenId */
export function getMenuStorageKey(canteenId) {
  return storageKeyFor(normalizeCanteenId(canteenId));
}

// ─── Hash / entry builders ───────────────────────────────────────────────────

/**
 * Content fingerprint for version-aware invalidation (client-side until backend exposes menuVersion).
 * @param {unknown[]} data
 */
function computeMenuHash(data) {
  if (!Array.isArray(data) || data.length === 0) return 'empty';
  let h = 5381;
  const n = Math.min(data.length, 500);
  for (let i = 0; i < n; i++) {
    const row = data[i];
    if (!row || typeof row !== 'object') continue;
    const piece = `${row.id}|${row.price}|${row.available_stock}|${row.is_active}|${row.is_vegetarian}`;
    for (let j = 0; j < piece.length; j++) {
      h = ((h << 5) + h) ^ piece.charCodeAt(j);
    }
  }
  h = ((h << 5) + h) ^ data.length;
  return (h >>> 0).toString(16);
}

/**
 * Pull optional backend version fields when present (future-compatible; not hardcoded as required).
 * @param {unknown} result
 */
function extractBackendMeta(result) {
  if (!result || typeof result !== 'object') {
    return { menuVersion: null, backendUpdatedAt: null };
  }
  const meta = result.meta && typeof result.meta === 'object' ? result.meta : result;
  const menuVersion =
    meta.menuVersion ?? meta.menu_version ?? meta.version ?? null;
  const backendUpdatedAtRaw =
    meta.updatedAt ?? meta.updated_at ?? meta.menuUpdatedAt ?? null;
  let backendUpdatedAt = null;
  if (typeof backendUpdatedAtRaw === 'number' && Number.isFinite(backendUpdatedAtRaw)) {
    backendUpdatedAt = backendUpdatedAtRaw;
  } else if (typeof backendUpdatedAtRaw === 'string' && backendUpdatedAtRaw) {
    const t = Date.parse(backendUpdatedAtRaw);
    backendUpdatedAt = Number.isFinite(t) ? t : null;
  }
  return { menuVersion, backendUpdatedAt };
}

/**
 * @param {string} canteenIdNormalized
 * @param {unknown[]} data
 * @param {object} [backendMeta]
 * @returns {MenuCacheEntry}
 */
function buildEntry(canteenIdNormalized, data, backendMeta = {}) {
  const now = Date.now();
  const list = Array.isArray(data) ? data : [];
  return {
    version: CACHE_ENTRY_VERSION,
    canteenId: canteenIdNormalized,
    updatedAt: now,
    expiresAt: now + CACHE_TTL_MS,
    itemCount: list.length,
    menuHash: computeMenuHash(list),
    data: list,
    menuVersion: backendMeta.menuVersion ?? null,
    backendUpdatedAt: backendMeta.backendUpdatedAt ?? null,
  };
}

/** @param {MenuCacheEntry|null|undefined} entry */
function isEntryShapeValid(entry) {
  return Boolean(
    entry &&
      typeof entry === 'object' &&
      Array.isArray(entry.data) &&
      typeof entry.canteenId === 'string' &&
      typeof entry.updatedAt === 'number' &&
      Number.isFinite(entry.updatedAt)
  );
}

/** @param {MenuCacheEntry} entry */
function isFresh(entry) {
  if (!isEntryShapeValid(entry)) return false;
  const expiresAt =
    typeof entry.expiresAt === 'number' && Number.isFinite(entry.expiresAt)
      ? entry.expiresAt
      : entry.updatedAt + CACHE_TTL_MS;
  return Date.now() < expiresAt;
}

/** @param {MenuCacheEntry} entry */
function isPastCleanupAge(entry) {
  const updatedAt = entry?.updatedAt ?? 0;
  return Date.now() - updatedAt > CLEANUP_MAX_AGE_MS;
}

// ─── Index ───────────────────────────────────────────────────────────────────

/** @returns {Promise<string[]>} */
async function readIndex() {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (raw == null || raw === '') return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id)).filter(Boolean);
  } catch {
    return [];
  }
}

/** @param {string[]} ids */
async function writeIndex(ids) {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(unique));
}

/** @param {string} canteenIdNormalized */
async function ensureInIndex(canteenIdNormalized) {
  try {
    const ids = await readIndex();
    if (!ids.includes(canteenIdNormalized)) {
      ids.push(canteenIdNormalized);
      await writeIndex(ids);
    }
  } catch (_) {
    // Index write failure must not block serving menu
  }
}

/** @param {string} canteenIdNormalized */
async function removeFromIndex(canteenIdNormalized) {
  try {
    const ids = await readIndex();
    const next = ids.filter((id) => id !== canteenIdNormalized);
    if (next.length !== ids.length) await writeIndex(next);
  } catch (_) {}
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Coerce legacy `{ data, timestamp, scopeKey }` into MenuCacheEntry.
 * @param {unknown} parsed
 * @param {string} fallbackCanteenId
 * @returns {MenuCacheEntry|null}
 */
function coercePersistedEntry(parsed, fallbackCanteenId) {
  if (!parsed || typeof parsed !== 'object') return null;

  // New shape
  if (Array.isArray(parsed.data) && typeof parsed.updatedAt === 'number') {
    const canteenId =
      typeof parsed.canteenId === 'string' && parsed.canteenId
        ? parsed.canteenId
        : fallbackCanteenId;
    const updatedAt = parsed.updatedAt;
    const expiresAt =
      typeof parsed.expiresAt === 'number'
        ? parsed.expiresAt
        : updatedAt + CACHE_TTL_MS;
    return {
      version: typeof parsed.version === 'number' ? parsed.version : CACHE_ENTRY_VERSION,
      canteenId,
      updatedAt,
      expiresAt,
      itemCount:
        typeof parsed.itemCount === 'number' ? parsed.itemCount : parsed.data.length,
      menuHash:
        typeof parsed.menuHash === 'string' ? parsed.menuHash : computeMenuHash(parsed.data),
      data: parsed.data,
      menuVersion: parsed.menuVersion ?? null,
      backendUpdatedAt: parsed.backendUpdatedAt ?? null,
    };
  }

  // Legacy single-key shape
  if (Array.isArray(parsed.data) && typeof parsed.timestamp === 'number') {
    const scope =
      typeof parsed.scopeKey === 'string' && parsed.scopeKey
        ? parsed.scopeKey
        : fallbackCanteenId;
    const updatedAt = parsed.timestamp;
    return {
      version: CACHE_ENTRY_VERSION,
      canteenId: scope || UNSCOPED_ID,
      updatedAt,
      expiresAt: updatedAt + CACHE_TTL_MS,
      itemCount: parsed.data.length,
      menuHash: computeMenuHash(parsed.data),
      data: parsed.data,
      menuVersion: null,
      backendUpdatedAt: null,
    };
  }

  return null;
}

/** @param {string} canteenIdNormalized @returns {Promise<MenuCacheEntry|null>} */
async function readPersistedEntry(canteenIdNormalized) {
  const key = storageKeyFor(canteenIdNormalized);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null || raw === '') {
      // One-time legacy migration for this scope
      if (canteenIdNormalized !== UNSCOPED_ID) {
        const legacy = await migrateLegacyIfMatches(canteenIdNormalized);
        if (legacy) return legacy;
      }
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      cacheLog('CACHE MISS', { reason: 'invalid_json', canteenId: canteenIdNormalized });
      await AsyncStorage.removeItem(key).catch(() => {});
      return null;
    }
    const entry = coercePersistedEntry(parsed, canteenIdNormalized);
    if (!entry || entry.canteenId !== canteenIdNormalized) {
      cacheLog('CACHE MISS', { reason: 'corrupted_or_mismatch', canteenId: canteenIdNormalized });
      await AsyncStorage.removeItem(key).catch(() => {});
      return null;
    }
    return entry;
  } catch (e) {
    cacheLog('CACHE MISS', {
      reason: 'storage_read_failed',
      canteenId: canteenIdNormalized,
      message: e?.message,
    });
    return null;
  }
}

/**
 * Migrate old global `menu_cache` key into per-canteen storage when scope matches.
 * @param {string} canteenIdNormalized
 */
async function migrateLegacyIfMatches(canteenIdNormalized) {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw == null || raw === '') return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
      return null;
    }
    const entry = coercePersistedEntry(parsed, canteenIdNormalized);
    if (!entry) {
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
      return null;
    }
    const legacyScope =
      typeof parsed.scopeKey === 'string' ? parsed.scopeKey || UNSCOPED_ID : entry.canteenId;
    if (legacyScope !== canteenIdNormalized) return null;

    await writePersistedEntry(entry);
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
    cacheLog('CACHE SAVED', { reason: 'legacy_migrated', canteenId: canteenIdNormalized });
    return entry;
  } catch {
    return null;
  }
}

/** @param {MenuCacheEntry} entry */
async function writePersistedEntry(entry) {
  if (!isEntryShapeValid(entry)) return;
  const key = storageKeyFor(entry.canteenId);
  try {
    // Write entry then index — partial write: entry alone is still usable; index repaired by cleanup.
    await AsyncStorage.setItem(key, JSON.stringify(entry));
    await ensureInIndex(entry.canteenId);
    cacheLog('CACHE SAVED', {
      canteenId: entry.canteenId,
      itemCount: entry.itemCount,
      expiresAt: entry.expiresAt,
    });
  } catch (e) {
    cacheLog('CACHE SAVED', {
      failed: true,
      canteenId: entry.canteenId,
      message: e?.message,
    });
  }
}

// ─── Last canteen (offline startup) ──────────────────────────────────────────

/**
 * Remember the last successfully used canteen for offline Home startup.
 * Persists name + takeaway_charge (same pattern as canteen name for cart totals).
 * @param {string|null|undefined} canteenId
 * @param {string} [name]
 * @param {{ takeawayCharge?: number|null }} [extra]
 */
export async function rememberLastCanteen(canteenId, name = '', extra = {}) {
  const id = normalizeCanteenId(canteenId);
  if (id === UNSCOPED_ID) return;
  try {
    let takeawayCharge = null;
    if (extra && Object.prototype.hasOwnProperty.call(extra, 'takeawayCharge')) {
      const n = Number(extra.takeawayCharge);
      takeawayCharge = Number.isFinite(n) ? n : null;
    } else {
      // Preserve prior fee when callers only pass id/name (e.g. menu save path).
      try {
        const prev = await getLastRememberedCanteen();
        if (prev?.id === id && prev.takeawayCharge != null) {
          takeawayCharge = prev.takeawayCharge;
        }
      } catch (_) {}
    }
    await AsyncStorage.setItem(
      LAST_CANTEEN_KEY,
      JSON.stringify({
        id,
        name: name || '',
        takeaway_charge: takeawayCharge,
        at: Date.now(),
      })
    );
  } catch (_) {}
}

/** @returns {Promise<{ id: string, name: string, takeawayCharge: number|null }|null>} */
export async function getLastRememberedCanteen() {
  try {
    const raw = await AsyncStorage.getItem(LAST_CANTEEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.id != null && String(parsed.id)) {
      const feeRaw = parsed.takeaway_charge ?? parsed.takeawayCharge;
      const feeNum = Number(feeRaw);
      return {
        id: String(parsed.id),
        name: typeof parsed.name === 'string' ? parsed.name : '',
        takeawayCharge: Number.isFinite(feeNum) ? feeNum : null,
      };
    }
  } catch (_) {}
  return null;
}

// ─── Subscribers (background refresh → React state) ──────────────────────────

/**
 * Subscribe to menu updates after background refresh (or forced refresh).
 * @param {string|null|undefined} canteenId
 * @param {(data: unknown[], entry: MenuCacheEntry) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribeMenuUpdates(canteenId, callback) {
  const id = normalizeCanteenId(canteenId);
  if (typeof callback !== 'function') return () => {};
  let set = subscribers.get(id);
  if (!set) {
    set = new Set();
    subscribers.set(id, set);
  }
  set.add(callback);
  return () => {
    const s = subscribers.get(id);
    if (!s) return;
    s.delete(callback);
    if (s.size === 0) subscribers.delete(id);
  };
}

/** @param {string} canteenIdNormalized @param {MenuCacheEntry} entry */
function notifySubscribers(canteenIdNormalized, entry) {
  const set = subscribers.get(canteenIdNormalized);
  if (!set || set.size === 0) return;
  for (const cb of [...set]) {
    try {
      cb(entry.data, entry);
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[MenuCache] subscriber error', e);
      }
    }
  }
}

// ─── Network (deduped) ───────────────────────────────────────────────────────

/**
 * Single-flight network fetch per canteen.
 * @param {string|null|undefined} canteenId
 * @param {string} canteenIdNormalized
 */
function fetchMenuFromNetwork(canteenId, canteenIdNormalized) {
  const existing = inflightNetwork.get(canteenIdNormalized);
  if (existing) return existing;

  cacheLog('NETWORK REQUEST', { canteenId: canteenIdNormalized });

  const promise = (async () => {
    try {
      const result = await foodService.getAllItems(
        canteenIdNormalized === UNSCOPED_ID ? null : canteenId
      );
      const fetchError = result?.error ?? null;
      const list = result?.data;
      if (!fetchError && Array.isArray(list)) {
        return {
          data: list,
          error: null,
          meta: extractBackendMeta(result),
        };
      }
      return { data: null, error: fetchError || { message: 'Menu fetch failed' }, meta: {} };
    } catch (e) {
      return {
        data: null,
        error: e instanceof Error ? e : { message: String(e?.message || e) },
        meta: {},
      };
    } finally {
      inflightNetwork.delete(canteenIdNormalized);
    }
  })();

  inflightNetwork.set(canteenIdNormalized, promise);
  return promise;
}

/**
 * @param {string|null|undefined} canteenId
 * @param {string} canteenIdNormalized
 * @param {object} [backendMeta]
 */
async function saveFetchedMenu(canteenId, canteenIdNormalized, list, backendMeta) {
  const entry = buildEntry(canteenIdNormalized, list, backendMeta);
  memoryCache.set(canteenIdNormalized, entry);
  await writePersistedEntry(entry);
  if (canteenIdNormalized !== UNSCOPED_ID) {
    rememberLastCanteen(canteenIdNormalized).catch(() => {});
  }
  notifySubscribers(canteenIdNormalized, entry);
  return entry;
}

function throwFetchError(fetchErr) {
  cacheLog('NO CACHE AVAILABLE');
  if (fetchErr instanceof Error) throw fetchErr;
  const m =
    fetchErr && typeof fetchErr.message === 'string' ? fetchErr.message : null;
  throw new Error(m || 'Menu fetch failed');
}

/** Create a stable Offline error for callers that prefer error objects. */
export function createOfflineMenuError() {
  const err = new Error(
    'You appear to be offline and no cached menu is available for this canteen.'
  );
  err.code = 'MENU_OFFLINE_NO_CACHE';
  return err;
}

// ─── Background refresh ──────────────────────────────────────────────────────

/**
 * @param {string|null|undefined} canteenId
 * @param {string} canteenIdNormalized
 * @param {(data: unknown[]) => void} [onUpdate]
 */
function scheduleBackgroundRefresh(canteenId, canteenIdNormalized, onUpdate) {
  if (inflightBackground.has(canteenIdNormalized)) {
    return inflightBackground.get(canteenIdNormalized);
  }
  if (inflightNetwork.has(canteenIdNormalized)) {
    return inflightNetwork.get(canteenIdNormalized).then(() => {});
  }

  cacheLog('CACHE REFRESH STARTED', { canteenId: canteenIdNormalized });
  backgroundStatus.set(canteenIdNormalized, 'refreshing');

  const promise = (async () => {
    try {
      const { data, error, meta } = await fetchMenuFromNetwork(
        canteenId,
        canteenIdNormalized
      );
      if (error || !Array.isArray(data)) {
        backgroundStatus.set(canteenIdNormalized, 'failed');
        cacheLog('CACHE REFRESH FAILED', {
          canteenId: canteenIdNormalized,
          message: error?.message || String(error),
        });
        return;
      }
      const entry = await saveFetchedMenu(
        canteenId,
        canteenIdNormalized,
        data,
        meta
      );
      backgroundStatus.set(canteenIdNormalized, 'success');
      cacheLog('CACHE REFRESH SUCCESS', {
        canteenId: canteenIdNormalized,
        itemCount: entry.itemCount,
      });
      if (typeof onUpdate === 'function') {
        try {
          onUpdate(entry.data);
        } catch (_) {}
      }
    } catch (e) {
      backgroundStatus.set(canteenIdNormalized, 'failed');
      cacheLog('CACHE REFRESH FAILED', {
        canteenId: canteenIdNormalized,
        message: e?.message || String(e),
      });
    } finally {
      inflightBackground.delete(canteenIdNormalized);
    }
  })();

  inflightBackground.set(canteenIdNormalized, promise);
  return promise;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Offline-first menu load.
 * Memory → AsyncStorage → (fresh return | stale + background refresh | network).
 *
 * @param {string|null} [canteenId]
 * @param {GetMenuOptions} [options]
 * @returns {Promise<GetMenuResult>}
 */
export async function getMenu(canteenId = null, options = {}) {
  const { forceRefresh = false, onUpdate } = options;
  const id = normalizeCanteenId(canteenId);

  if (!cleanupRanThisSession) {
    cleanupRanThisSession = true;
    cleanupExpiredCaches().catch(() => {});
  }

  // 1) Memory — fresh
  if (!forceRefresh) {
    const mem = memoryCache.get(id);
    if (mem && isEntryShapeValid(mem) && isFresh(mem)) {
      cacheLog('CACHE HIT (Memory)', { canteenId: id, itemCount: mem.itemCount });
      return { data: mem.data, error: null, fromCache: true, stale: false };
    }
  }

  // 2) AsyncStorage
  let persisted = null;
  try {
    persisted = await readPersistedEntry(id);
  } catch (_) {
    persisted = null;
  }

  if (!forceRefresh && persisted && isFresh(persisted)) {
    memoryCache.set(id, persisted);
    cacheLog('CACHE HIT (AsyncStorage)', {
      canteenId: id,
      itemCount: persisted.itemCount,
    });
    return { data: persisted.data, error: null, fromCache: true, stale: false };
  }

  // 3) Stale cache — return immediately + refresh in background
  const staleMem = memoryCache.get(id);
  const stale = isEntryShapeValid(staleMem)
    ? staleMem
    : isEntryShapeValid(persisted)
      ? persisted
      : null;

  if (!forceRefresh && stale) {
    memoryCache.set(id, stale);
    cacheLog('CACHE STALE', { canteenId: id, updatedAt: stale.updatedAt });
    cacheLog('OFFLINE CACHE USED', { canteenId: id, mode: 'stale_while_revalidate' });
    scheduleBackgroundRefresh(canteenId, id, onUpdate);
    return { data: stale.data, error: null, fromCache: true, stale: true };
  }

  // 4) Network (no usable cache, or forceRefresh)
  cacheLog('CACHE MISS', { canteenId: id, forceRefresh });
  const { data, error, meta } = await fetchMenuFromNetwork(canteenId, id);

  if (!error && Array.isArray(data)) {
    const entry = await saveFetchedMenu(canteenId, id, data, meta);
    if (typeof onUpdate === 'function') {
      try {
        onUpdate(entry.data);
      } catch (_) {}
    }
    return { data: entry.data, error: null, fromCache: false, stale: false };
  }

  // 5) API failure — any cache (including forceRefresh path)
  if (staleMem && isEntryShapeValid(staleMem)) {
    cacheLog('OFFLINE CACHE USED', { canteenId: id, mode: 'api_failure_memory' });
    return { data: staleMem.data, error: null, fromCache: true, stale: true };
  }
  if (persisted && isEntryShapeValid(persisted)) {
    memoryCache.set(id, persisted);
    cacheLog('OFFLINE CACHE USED', { canteenId: id, mode: 'api_failure_storage' });
    return { data: persisted.data, error: null, fromCache: true, stale: true };
  }

  // Re-read in case another writer finished during the failed request
  const retryPersisted = await readPersistedEntry(id);
  if (retryPersisted && isEntryShapeValid(retryPersisted)) {
    memoryCache.set(id, retryPersisted);
    cacheLog('OFFLINE CACHE USED', { canteenId: id, mode: 'api_failure_reread' });
    return { data: retryPersisted.data, error: null, fromCache: true, stale: true };
  }

  throwFetchError(error || createOfflineMenuError());
}

/**
 * Force a network refresh; updates memory + AsyncStorage. Falls back to cache on failure.
 * @param {string|null} [canteenId]
 * @returns {Promise<GetMenuResult>}
 */
export async function refreshMenu(canteenId = null) {
  return getMenu(canteenId, { forceRefresh: true });
}

/**
 * Mark cache stale / remove from memory (AsyncStorage kept until cleanup or clear).
 * Next getMenu will treat as miss/stale and refresh.
 * @param {string|null} [canteenId]
 */
export async function invalidateMenu(canteenId = null) {
  const id = normalizeCanteenId(canteenId);
  const mem = memoryCache.get(id);
  if (mem) {
    memoryCache.set(id, { ...mem, expiresAt: 0 });
  }
  // Soft-invalidate storage so TTL checks fail but data remains for offline fallback
  try {
    const persisted = await readPersistedEntry(id);
    if (persisted) {
      const soft = { ...persisted, expiresAt: 0 };
      await AsyncStorage.setItem(storageKeyFor(id), JSON.stringify(soft));
      memoryCache.set(id, soft);
    }
  } catch (_) {}
  cacheLog('CACHE INVALIDATED', { canteenId: id });
}

/**
 * Delete one canteen’s cache from memory + AsyncStorage + index.
 * @param {string|null} [canteenId]
 */
export async function clearMenuCache(canteenId = null) {
  const id = normalizeCanteenId(canteenId);
  memoryCache.delete(id);
  try {
    await AsyncStorage.removeItem(storageKeyFor(id));
  } catch (_) {}
  await removeFromIndex(id);
  cacheLog('CACHE INVALIDATED', { canteenId: id, cleared: true });
}

/** Wipe all menu caches (memory + storage + index). Also removes legacy key. */
export async function clearAllMenuCache() {
  const ids = await readIndex();
  memoryCache.clear();
  const keys = ids.map((id) => storageKeyFor(id));
  keys.push(LEGACY_STORAGE_KEY, INDEX_KEY);
  try {
    await AsyncStorage.multiRemove([...new Set(keys)]);
  } catch (_) {
    for (const k of keys) {
      try {
        await AsyncStorage.removeItem(k);
      } catch (_) {}
    }
  }
  try {
    await writeIndex([]);
  } catch (_) {}
  cacheLog('CACHE INVALIDATED', { clearedAll: true });
}

/** @returns {Promise<string[]>} */
export async function getCachedCanteens() {
  const fromIndex = await readIndex();
  const fromMemory = [...memoryCache.keys()];
  return [...new Set([...fromIndex, ...fromMemory])];
}

/**
 * Delete expired caches older than 24h; drop orphaned keys; repair index.
 * Runs silently — safe to call from app startup / getMenu.
 */
export async function cleanupExpiredCaches() {
  cacheLog('CACHE CLEANUP', { started: true });
  try {
    const ids = await readIndex();
    const kept = [];
    for (const id of ids) {
      const entry = await readPersistedEntry(id);
      if (!entry) {
        // Orphaned index entry or unreadable — drop
        try {
          await AsyncStorage.removeItem(storageKeyFor(id));
        } catch (_) {}
        memoryCache.delete(id);
        continue;
      }
      if (isPastCleanupAge(entry) && !isFresh(entry)) {
        try {
          await AsyncStorage.removeItem(storageKeyFor(id));
        } catch (_) {}
        memoryCache.delete(id);
        continue;
      }
      kept.push(id);
    }

    // Scan for orphaned menu_cache_* keys not in index
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const menuKeys = allKeys.filter(
        (k) =>
          k.startsWith(STORAGE_KEY_PREFIX) &&
          k !== INDEX_KEY &&
          k !== LEGACY_STORAGE_KEY
      );
      for (const key of menuKeys) {
        const id = key.slice(STORAGE_KEY_PREFIX.length);
        if (!id || kept.includes(id)) continue;
        const entry = await readPersistedEntry(id);
        if (!entry || (isPastCleanupAge(entry) && !isFresh(entry))) {
          await AsyncStorage.removeItem(key).catch(() => {});
          memoryCache.delete(id);
        } else if (entry) {
          kept.push(id);
        }
      }
    } catch (_) {
      // getAllKeys may fail on some platforms — index-only cleanup is enough
    }

    // Drop legacy global key after migration attempts
    try {
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (_) {}

    await writeIndex([...new Set(kept)]);
    cacheLog('CACHE CLEANUP', { kept: kept.length });
  } catch (e) {
    cacheLog('CACHE CLEANUP', { failed: true, message: e?.message });
  }
}

/**
 * Warm memory + storage for a canteen (non-blocking for callers that fire-and-forget).
 * @param {string|null} [canteenId]
 */
export async function preloadMenu(canteenId = null) {
  try {
    await getMenu(canteenId);
  } catch (_) {
    // Preload must never throw into UI
  }
}

/**
 * Paginated view over the cached full menu (same contract as foodService.getFoodItemsPage).
 * Uses getMenu so Home + Cart share one network request.
 *
 * @param {string|null} categoryId
 * @param {string|null} canteenId
 * @param {number} offset
 * @param {number} pageSize
 * @param {{ forceRefresh?: boolean, onUpdate?: (data: unknown[]) => void }} [pageOptions]
 * @returns {Promise<{ data: unknown[], error: unknown|null, hasMore: boolean }>}
 */
export async function getMenuPage(
  categoryId = null,
  canteenId = null,
  offset = 0,
  pageSize = 10,
  pageOptions = {}
) {
  const forceRefresh = Boolean(
    pageOptions?.forceRefresh ?? pageOptions?.forceHttpRefresh
  );
  const ps = Number.isFinite(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 10;
  const from = Math.max(0, Math.floor(offset));

  try {
    const { data: all, error } = await getMenu(canteenId, {
      forceRefresh: forceRefresh && from === 0,
      onUpdate: pageOptions?.onUpdate,
    });

    if (error) {
      return { data: [], error, hasMore: false };
    }

    let rows = Array.isArray(all) ? [...all] : [];
    if (categoryId != null && categoryId !== '') {
      const cat = String(categoryId);
      rows = rows.filter((r) => String(r?.category_id || '') === cat);
    }
    rows.sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));

    const slice = rows.slice(from, from + ps);
    const hasMore = from + slice.length < rows.length;
    return { data: slice, error: null, hasMore };
  } catch (e) {
    return {
      data: [],
      error: e instanceof Error ? e : { message: String(e?.message || e) },
      hasMore: false,
    };
  }
}

// ─── Debug snapshot (DEV) ────────────────────────────────────────────────────

/**
 * Snapshot for the DEV debug panel. Safe to call in production (returns empty).
 * @returns {Promise<object>}
 */
export async function getMenuCacheDebugSnapshot() {
  const canteens = await getCachedCanteens();
  const entries = [];

  for (const id of canteens) {
    const mem = memoryCache.get(id) || null;
    let storage = null;
    try {
      storage = await readPersistedEntry(id);
    } catch (_) {}
    const entry = mem || storage;
    let storageBytes = 0;
    try {
      const raw = await AsyncStorage.getItem(storageKeyFor(id));
      storageBytes = raw ? raw.length : 0;
    } catch (_) {}

    entries.push({
      canteenId: id,
      itemCount: entry?.itemCount ?? entry?.data?.length ?? 0,
      updatedAt: entry?.updatedAt ?? null,
      expiresAt: entry?.expiresAt ?? null,
      fresh: entry ? isFresh(entry) : false,
      menuHash: entry?.menuHash ?? null,
      menuVersion: entry?.menuVersion ?? null,
      inMemory: Boolean(mem),
      inAsyncStorage: Boolean(storage),
      storageBytes,
      backgroundStatus: backgroundStatus.get(id) || 'idle',
    });
  }

  return {
    ttlMs: CACHE_TTL_MS,
    cleanupMaxAgeMs: CLEANUP_MAX_AGE_MS,
    entryVersion: CACHE_ENTRY_VERSION,
    memorySize: memoryCache.size,
    inflightNetwork: [...inflightNetwork.keys()],
    inflightBackground: [...inflightBackground.keys()],
    entries,
  };
}

/** @param {string|null|undefined} canteenId */
export function getBackgroundRefreshStatus(canteenId = null) {
  return backgroundStatus.get(normalizeCanteenId(canteenId)) || 'idle';
}
