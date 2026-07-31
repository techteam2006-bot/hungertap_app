/**
 * Offline-first cart persistence (AsyncStorage + memory).
 *
 * Local mode (`CART_STORAGE=local`): source of truth is device storage.
 * Remote mode: optional snapshot for offline hydrate while network refreshes.
 *
 * Hierarchy: Memory Map → AsyncStorage → (remote only) network via CartContext.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_ENTRY_VERSION = 1;
const LOCAL_PREFIX = 'local_cart_v1_';
const REMOTE_PREFIX = 'remote_cart_cache_v1_';

/** @type {Map<string, { version: number, userId: string, updatedAt: number, itemCount: number, data: unknown[] }>} */
const memoryLocal = new Map();
/** @type {Map<string, { version: number, userId: string, updatedAt: number, itemCount: number, data: unknown[] }>} */
const memoryRemote = new Map();

function cacheLog(event, extra) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (extra && Object.keys(extra).length) {
    console.log(`[CartCache] ${event}`, extra);
  } else {
    console.log(`[CartCache] ${event}`);
  }
}

export function getCartStorageKey(userId) {
  return `${LOCAL_PREFIX}${userId}`;
}

function remoteKey(userId) {
  return `${REMOTE_PREFIX}${userId}`;
}

/**
 * @param {string} userId
 * @param {unknown[]} data
 */
function buildEntry(userId, data) {
  const list = Array.isArray(data) ? data : [];
  return {
    version: CACHE_ENTRY_VERSION,
    userId: String(userId),
    updatedAt: Date.now(),
    itemCount: list.length,
    data: list,
  };
}

/**
 * Accepts legacy raw arrays or envelope objects.
 * @param {unknown} parsed
 * @param {string} userId
 */
function coerceEntry(parsed, userId) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) {
    return buildEntry(userId, parsed);
  }
  if (typeof parsed === 'object' && Array.isArray(parsed.data)) {
    return {
      version: typeof parsed.version === 'number' ? parsed.version : CACHE_ENTRY_VERSION,
      userId: typeof parsed.userId === 'string' ? parsed.userId : String(userId),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      itemCount:
        typeof parsed.itemCount === 'number' ? parsed.itemCount : parsed.data.length,
      data: parsed.data,
    };
  }
  return null;
}

async function readKey(key, userId, memoryMap) {
  const mem = memoryMap.get(String(userId));
  if (mem && Array.isArray(mem.data)) {
    cacheLog('CACHE HIT (Memory)', { userId, itemCount: mem.itemCount, key });
    return mem;
  }
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null || raw === '') {
      cacheLog('CACHE MISS', { userId, key });
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      cacheLog('CACHE MISS', { userId, key, reason: 'invalid_json' });
      await AsyncStorage.removeItem(key).catch(() => {});
      return null;
    }
    const entry = coerceEntry(parsed, userId);
    if (!entry) {
      cacheLog('CACHE MISS', { userId, key, reason: 'bad_shape' });
      return null;
    }
    memoryMap.set(String(userId), entry);
    // Upgrade legacy raw arrays to envelope on read
    if (Array.isArray(parsed)) {
      await AsyncStorage.setItem(key, JSON.stringify(entry)).catch(() => {});
    }
    cacheLog('CACHE HIT (AsyncStorage)', { userId, itemCount: entry.itemCount, key });
    return entry;
  } catch (e) {
    cacheLog('CACHE MISS', { userId, key, reason: e?.message });
    return null;
  }
}

async function writeKey(key, userId, data, memoryMap) {
  const entry = buildEntry(userId, data);
  memoryMap.set(String(userId), entry);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
    cacheLog('CACHE SAVED', { userId, itemCount: entry.itemCount, key });
  } catch (e) {
    cacheLog('CACHE SAVED', { userId, key, failed: true, message: e?.message });
  }
  return entry;
}

/** @param {string|null|undefined} userId @returns {Promise<unknown[]>} */
export async function loadLocalCart(userId) {
  if (!userId) return [];
  const entry = await readKey(getCartStorageKey(userId), userId, memoryLocal);
  return entry?.data || [];
}

/** @param {string|null|undefined} userId @param {unknown[]} cartItems */
export async function saveLocalCart(userId, cartItems) {
  if (!userId) return;
  await writeKey(getCartStorageKey(userId), userId, cartItems, memoryLocal);
}

/** @param {string|null|undefined} userId */
export async function clearLocalCartStorage(userId) {
  if (!userId) return;
  memoryLocal.delete(String(userId));
  try {
    await AsyncStorage.removeItem(getCartStorageKey(userId));
    cacheLog('CACHE INVALIDATED', { userId, mode: 'local' });
  } catch (e) {
    cacheLog('CACHE INVALIDATED', { userId, failed: true, message: e?.message });
  }
}

/** Remote-mode offline snapshot (UI-shaped cart lines). */
export async function loadRemoteCartCache(userId) {
  if (!userId) return [];
  const entry = await readKey(remoteKey(userId), userId, memoryRemote);
  return entry?.data || [];
}

export async function saveRemoteCartCache(userId, cartItems) {
  if (!userId) return;
  await writeKey(remoteKey(userId), userId, cartItems, memoryRemote);
}

export async function clearRemoteCartCache(userId) {
  if (!userId) return;
  memoryRemote.delete(String(userId));
  try {
    await AsyncStorage.removeItem(remoteKey(userId));
    cacheLog('CACHE INVALIDATED', { userId, mode: 'remote' });
  } catch (_) {}
}
