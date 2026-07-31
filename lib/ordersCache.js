/**
 * Offline-first past-orders cache.
 *
 * Hierarchy: Memory → AsyncStorage → `fetchUserOrdersWithLineJoins`.
 * Stores the raw join payload so OrdersScreen mapping stays unchanged.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchUserOrdersWithLineJoins } from './orderQueries';

const CACHE_ENTRY_VERSION = 1;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'orders_cache_v1_';
const INDEX_KEY = 'orders_cache_index';

/** @type {Map<string, object>} */
const memoryCache = new Map();
/** @type {Map<string, Promise<{ data: unknown[]|null, error: unknown|null }>>} */
const inflightNetwork = new Map();
/** @type {Map<string, Promise<void>>} */
const inflightBackground = new Map();

let cleanupRanThisSession = false;

function cacheLog(event, extra) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (extra && Object.keys(extra).length) {
    console.log(`[OrdersCache] ${event}`, extra);
  } else {
    console.log(`[OrdersCache] ${event}`);
  }
}

function storageKey(userId) {
  return `${STORAGE_PREFIX}${userId}`;
}

function buildEntry(userId, data) {
  const list = Array.isArray(data) ? data : [];
  const now = Date.now();
  return {
    version: CACHE_ENTRY_VERSION,
    userId: String(userId),
    updatedAt: now,
    expiresAt: now + CACHE_TTL_MS,
    orderCount: list.length,
    data: list,
  };
}

function isEntryValid(entry) {
  return Boolean(entry && Array.isArray(entry.data) && typeof entry.updatedAt === 'number');
}

function isFresh(entry) {
  if (!isEntryValid(entry)) return false;
  const expiresAt =
    typeof entry.expiresAt === 'number' ? entry.expiresAt : entry.updatedAt + CACHE_TTL_MS;
  return Date.now() < expiresAt;
}

async function readIndex() {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify([...new Set(ids.map(String))]));
}

async function ensureInIndex(userId) {
  try {
    const ids = await readIndex();
    if (!ids.includes(String(userId))) {
      ids.push(String(userId));
      await writeIndex(ids);
    }
  } catch (_) {}
}

async function readPersisted(userId) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await AsyncStorage.removeItem(storageKey(userId)).catch(() => {});
      return null;
    }
    if (!isEntryValid(parsed)) {
      await AsyncStorage.removeItem(storageKey(userId)).catch(() => {});
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writePersisted(entry) {
  if (!isEntryValid(entry)) return;
  try {
    await AsyncStorage.setItem(storageKey(entry.userId), JSON.stringify(entry));
    await ensureInIndex(entry.userId);
    cacheLog('CACHE SAVED', { userId: entry.userId, orderCount: entry.orderCount });
  } catch (e) {
    cacheLog('CACHE SAVED', { failed: true, message: e?.message });
  }
}

function fetchFromNetwork(supabase, userId) {
  const id = String(userId);
  const existing = inflightNetwork.get(id);
  if (existing) return existing;

  cacheLog('NETWORK REQUEST', { userId: id });
  const promise = (async () => {
    try {
      const result = await fetchUserOrdersWithLineJoins(supabase, id);
      return {
        data: Array.isArray(result?.data) ? result.data : null,
        error: result?.error ?? null,
      };
    } catch (e) {
      return {
        data: null,
        error: e instanceof Error ? e : { message: String(e?.message || e) },
      };
    } finally {
      inflightNetwork.delete(id);
    }
  })();

  inflightNetwork.set(id, promise);
  return promise;
}

async function saveOrders(userId, list) {
  const entry = buildEntry(userId, list);
  memoryCache.set(String(userId), entry);
  await writePersisted(entry);
  return entry;
}

function scheduleBackgroundRefresh(supabase, userId, onUpdate) {
  const id = String(userId);
  if (inflightBackground.has(id) || inflightNetwork.has(id)) {
    return inflightBackground.get(id) || Promise.resolve();
  }

  cacheLog('CACHE REFRESH STARTED', { userId: id });
  const promise = (async () => {
    try {
      const { data, error } = await fetchFromNetwork(supabase, id);
      if (error || !Array.isArray(data)) {
        cacheLog('CACHE REFRESH FAILED', { userId: id, message: error?.message });
        return;
      }
      const entry = await saveOrders(id, data);
      cacheLog('CACHE REFRESH SUCCESS', { userId: id, orderCount: entry.orderCount });
      if (typeof onUpdate === 'function') {
        try {
          onUpdate(entry.data);
        } catch (_) {}
      }
    } catch (e) {
      cacheLog('CACHE REFRESH FAILED', { userId: id, message: e?.message });
    } finally {
      inflightBackground.delete(id);
    }
  })();

  inflightBackground.set(id, promise);
  return promise;
}

export async function cleanupExpiredOrderCaches() {
  try {
    const ids = await readIndex();
    const kept = [];
    for (const id of ids) {
      const entry = await readPersisted(id);
      if (!entry) continue;
      if (Date.now() - entry.updatedAt > CLEANUP_MAX_AGE_MS && !isFresh(entry)) {
        await AsyncStorage.removeItem(storageKey(id)).catch(() => {});
        memoryCache.delete(id);
        continue;
      }
      kept.push(id);
    }
    await writeIndex(kept);
    cacheLog('CACHE CLEANUP', { kept: kept.length });
  } catch (e) {
    cacheLog('CACHE CLEANUP', { failed: true, message: e?.message });
  }
}

/**
 * Offline-first orders list (same shape as fetchUserOrdersWithLineJoins).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {{ forceRefresh?: boolean, onUpdate?: (data: unknown[]) => void }} [options]
 * @returns {Promise<{ data: unknown[], error: unknown|null, fromCache?: boolean, stale?: boolean }>}
 */
export async function getOrders(supabase, userId, options = {}) {
  const { forceRefresh = false, onUpdate } = options;
  if (!userId) {
    return { data: [], error: { message: 'Missing user' } };
  }
  const id = String(userId);

  if (!cleanupRanThisSession) {
    cleanupRanThisSession = true;
    cleanupExpiredOrderCaches().catch(() => {});
  }

  if (!forceRefresh) {
    const mem = memoryCache.get(id);
    if (mem && isFresh(mem)) {
      cacheLog('CACHE HIT (Memory)', { userId: id, orderCount: mem.orderCount });
      return { data: mem.data, error: null, fromCache: true, stale: false };
    }
  }

  let persisted = null;
  try {
    persisted = await readPersisted(id);
  } catch (_) {}

  if (!forceRefresh && persisted && isFresh(persisted)) {
    memoryCache.set(id, persisted);
    cacheLog('CACHE HIT (AsyncStorage)', { userId: id, orderCount: persisted.orderCount });
    return { data: persisted.data, error: null, fromCache: true, stale: false };
  }

  const staleMem = memoryCache.get(id);
  const stale = isEntryValid(staleMem) ? staleMem : isEntryValid(persisted) ? persisted : null;

  if (!forceRefresh && stale) {
    memoryCache.set(id, stale);
    cacheLog('CACHE STALE', { userId: id });
    cacheLog('OFFLINE CACHE USED', { userId: id, mode: 'stale_while_revalidate' });
    scheduleBackgroundRefresh(supabase, id, onUpdate);
    return { data: stale.data, error: null, fromCache: true, stale: true };
  }

  cacheLog('CACHE MISS', { userId: id, forceRefresh });
  const { data, error } = await fetchFromNetwork(supabase, id);

  if (!error && Array.isArray(data)) {
    const entry = await saveOrders(id, data);
    if (typeof onUpdate === 'function') {
      try {
        onUpdate(entry.data);
      } catch (_) {}
    }
    return { data: entry.data, error: null, fromCache: false, stale: false };
  }

  if (staleMem && isEntryValid(staleMem)) {
    cacheLog('OFFLINE CACHE USED', { userId: id, mode: 'api_failure_memory' });
    return { data: staleMem.data, error: null, fromCache: true, stale: true };
  }
  if (persisted && isEntryValid(persisted)) {
    memoryCache.set(id, persisted);
    cacheLog('OFFLINE CACHE USED', { userId: id, mode: 'api_failure_storage' });
    return { data: persisted.data, error: null, fromCache: true, stale: true };
  }

  cacheLog('NO CACHE AVAILABLE', { userId: id });
  return { data: [], error: error || { message: 'Orders fetch failed' } };
}

/** Soft-expire so next getOrders refreshes but offline fallback remains. */
export async function invalidateOrders(userId) {
  if (!userId) return;
  const id = String(userId);
  const mem = memoryCache.get(id);
  if (mem) memoryCache.set(id, { ...mem, expiresAt: 0 });
  try {
    const persisted = await readPersisted(id);
    if (persisted) {
      const soft = { ...persisted, expiresAt: 0 };
      await AsyncStorage.setItem(storageKey(id), JSON.stringify(soft));
      memoryCache.set(id, soft);
    }
  } catch (_) {}
  cacheLog('CACHE INVALIDATED', { userId: id });
}

export async function clearOrdersCache(userId) {
  if (!userId) return;
  const id = String(userId);
  memoryCache.delete(id);
  try {
    await AsyncStorage.removeItem(storageKey(id));
  } catch (_) {}
  try {
    const ids = await readIndex();
    await writeIndex(ids.filter((x) => x !== id));
  } catch (_) {}
  cacheLog('CACHE INVALIDATED', { userId: id, cleared: true });
}
