/**
 * Offline-first past-orders cache (paged).
 *
 * Hierarchy: Memory → AsyncStorage → `fetchUserOrdersPage`.
 * First page is cached; "See more" appends in memory (and persists the loaded window).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchUserOrdersPage, ORDERS_PAGE_SIZE } from './orderQueries';

const CACHE_ENTRY_VERSION = 2;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'orders_cache_v2_';
const INDEX_KEY = 'orders_cache_index_v2';

/** @type {Map<string, object>} */
const memoryCache = new Map();
/** @type {Map<string, Promise<object>>} */
const inflightNetwork = new Map();

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

function buildEntry(userId, data, hasMore) {
  const list = Array.isArray(data) ? data : [];
  const now = Date.now();
  return {
    version: CACHE_ENTRY_VERSION,
    userId: String(userId),
    updatedAt: now,
    expiresAt: now + CACHE_TTL_MS,
    orderCount: list.length,
    hasMore: Boolean(hasMore),
    data: list,
  };
}

function isEntryValid(entry) {
  return Boolean(
    entry &&
      entry.version === CACHE_ENTRY_VERSION &&
      Array.isArray(entry.data) &&
      typeof entry.updatedAt === 'number'
  );
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
    cacheLog('CACHE SAVED', {
      userId: entry.userId,
      orderCount: entry.orderCount,
      hasMore: entry.hasMore,
    });
  } catch (e) {
    cacheLog('CACHE SAVED', { failed: true, message: e?.message });
  }
}

function cursorFromList(list) {
  const last = Array.isArray(list) && list.length ? list[list.length - 1] : null;
  if (!last) return { beforeCreatedAt: null, beforeId: null };
  return {
    beforeCreatedAt: last.created_at || null,
    beforeId: last.id || null,
  };
}

async function saveOrders(userId, list, hasMore) {
  const entry = buildEntry(userId, list, hasMore);
  memoryCache.set(String(userId), entry);
  await writePersisted(entry);
  return entry;
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
 * First page (or cached window). Refresh/realtime should call with forceRefresh.
 *
 * @returns {Promise<{ data: unknown[], error: unknown|null, hasMore: boolean, fromCache?: boolean }>}
 */
export async function getOrders(supabase, userId, options = {}) {
  const { forceRefresh = false } = options;
  if (!userId) {
    return { data: [], error: { message: 'Missing user' }, hasMore: false };
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
      return {
        data: mem.data,
        error: null,
        hasMore: Boolean(mem.hasMore),
        fromCache: true,
      };
    }
  }

  let persisted = null;
  try {
    persisted = await readPersisted(id);
  } catch (_) {}

  if (!forceRefresh && persisted && isFresh(persisted)) {
    memoryCache.set(id, persisted);
    cacheLog('CACHE HIT (AsyncStorage)', { userId: id, orderCount: persisted.orderCount });
    return {
      data: persisted.data,
      error: null,
      hasMore: Boolean(persisted.hasMore),
      fromCache: true,
    };
  }

  const inflightKey = `${id}:reset`;
  if (inflightNetwork.has(inflightKey)) {
    return inflightNetwork.get(inflightKey);
  }

  cacheLog('NETWORK REQUEST', { userId: id, mode: 'reset' });
  const promise = (async () => {
    try {
      const result = await fetchUserOrdersPage(supabase, id, { limit: ORDERS_PAGE_SIZE });
      if (!result.error && Array.isArray(result.data)) {
        const entry = await saveOrders(id, result.data, result.hasMore);
        return {
          data: entry.data,
          error: null,
          hasMore: Boolean(entry.hasMore),
          fromCache: false,
        };
      }

      const staleMem = memoryCache.get(id);
      if (isEntryValid(staleMem)) {
        return {
          data: staleMem.data,
          error: null,
          hasMore: Boolean(staleMem.hasMore),
          fromCache: true,
        };
      }
      if (isEntryValid(persisted)) {
        memoryCache.set(id, persisted);
        return {
          data: persisted.data,
          error: null,
          hasMore: Boolean(persisted.hasMore),
          fromCache: true,
        };
      }
      return {
        data: [],
        error: result.error || { message: 'Orders fetch failed' },
        hasMore: false,
      };
    } finally {
      inflightNetwork.delete(inflightKey);
    }
  })();

  inflightNetwork.set(inflightKey, promise);
  return promise;
}

/**
 * Next page for "See more". Appends to the in-memory/persisted window.
 */
export async function getMoreOrders(supabase, userId) {
  if (!userId) {
    return { data: [], error: { message: 'Missing user' }, hasMore: false, appended: [] };
  }
  const id = String(userId);
  const current = memoryCache.get(id) || (await readPersisted(id));
  const existing = isEntryValid(current) ? current.data : [];
  const { beforeCreatedAt, beforeId } = cursorFromList(existing);

  if (!beforeCreatedAt || !beforeId) {
    const first = await getOrders(supabase, id, { forceRefresh: true });
    return {
      data: first.data,
      error: first.error,
      hasMore: first.hasMore,
      appended: first.data,
    };
  }

  const inflightKey = `${id}:more:${beforeCreatedAt}:${beforeId}`;
  if (inflightNetwork.has(inflightKey)) {
    return inflightNetwork.get(inflightKey);
  }

  cacheLog('NETWORK REQUEST', { userId: id, mode: 'more' });
  const promise = (async () => {
    try {
      const result = await fetchUserOrdersPage(supabase, id, {
        limit: ORDERS_PAGE_SIZE,
        beforeCreatedAt,
        beforeId,
      });
      if (result.error) {
        return {
          data: existing,
          error: result.error,
          hasMore: Boolean(current?.hasMore),
          appended: [],
        };
      }
      const appended = Array.isArray(result.data) ? result.data : [];
      const seen = new Set(existing.map((o) => String(o?.id)));
      const uniqueAppend = appended.filter((o) => o?.id && !seen.has(String(o.id)));
      const merged = existing.concat(uniqueAppend);
      const entry = await saveOrders(id, merged, result.hasMore);
      return {
        data: entry.data,
        error: null,
        hasMore: Boolean(entry.hasMore),
        appended: uniqueAppend,
      };
    } finally {
      inflightNetwork.delete(inflightKey);
    }
  })();

  inflightNetwork.set(inflightKey, promise);
  return promise;
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
    }
  } catch (_) {}
}

export async function clearOrdersCache(userId) {
  if (!userId) return;
  const id = String(userId);
  memoryCache.delete(id);
  await AsyncStorage.removeItem(storageKey(id)).catch(() => {});
}
