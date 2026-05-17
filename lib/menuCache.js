import AsyncStorage from '@react-native-async-storage/async-storage';
import { foodService } from './supabase';

/** AsyncStorage envelope; `scopeKey` aligns entries with the active canteen filter (same key string as storage). */
const MENU_CACHE_STORAGE_KEY = 'menu_cache';

const CACHE_DURATION = 10 * 60 * 1000;

/** @type {{ data: unknown[], timestamp: number, scopeKey: string } | null} */
let menuCache = null;

/** @param {string|null|undefined} canteenId */
function scopeKeyFromCanteenId(canteenId) {
  return canteenId == null || canteenId === '' ? '' : String(canteenId);
}

/** @param {number} timestamp */
function isFresh(timestamp) {
  return Date.now() - timestamp < CACHE_DURATION;
}

/**
 * @param {{ data: unknown[], timestamp: number, scopeKey: string }|null} entry
 * @param {string} scopeKey
 */
function entryValidForScope(entry, scopeKey) {
  return Boolean(entry && entry.scopeKey === scopeKey && Array.isArray(entry.data));
}

/** @returns {Promise<{ data: unknown[], timestamp: number, scopeKey: string } | null>} */
async function readPersistedEntry() {
  const raw = await AsyncStorage.getItem(MENU_CACHE_STORAGE_KEY);
  if (raw == null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.timestamp !== 'number' ||
      !Array.isArray(parsed.data)
    ) {
      return null;
    }
    const sk = typeof parsed.scopeKey === 'string' ? parsed.scopeKey : '';
    return { data: parsed.data, timestamp: parsed.timestamp, scopeKey: sk };
  } catch {
    return null;
  }
}

/**
 * @param {{ data: unknown[], timestamp: number, scopeKey: string }} entry
 */
async function writePersistedEntry(entry) {
  await AsyncStorage.setItem(MENU_CACHE_STORAGE_KEY, JSON.stringify(entry));
}

function throwFetchError(fetchErr) {
  if (fetchErr instanceof Error) throw fetchErr;
  const m =
    fetchErr && typeof fetchErr.message === 'string' ? fetchErr.message : null;
  throw new Error(m || 'Menu fetch failed');
}

/**
 * Cached menu load: memory → AsyncStorage (with expiry) → Supabase via existing `foodService.getAllItems`.
 * On fetch failure, returns last cached menu for the same scope if any; otherwise throws.
 *
 * @param {string|null} [canteenId] - Same as `foodService.getAllItems` (user’s canteen or null)
 * @param {{ forceRefresh?: boolean }} [options] - When true, skips fresh cache hits (e.g. pull-to-refresh)
 * @returns {Promise<{ data: unknown[], error: null }>}
 */
export async function getMenu(canteenId = null, options = {}) {
  const { forceRefresh = false } = options;
  const scopeKey = scopeKeyFromCanteenId(canteenId);

  if (
    !forceRefresh &&
    menuCache &&
    entryValidForScope(menuCache, scopeKey) &&
    isFresh(menuCache.timestamp)
  ) {
    return { data: menuCache.data, error: null };
  }

  const persisted = await readPersistedEntry();

  if (
    !forceRefresh &&
    persisted &&
    entryValidForScope(persisted, scopeKey) &&
    isFresh(persisted.timestamp)
  ) {
    menuCache = persisted;
    return { data: persisted.data, error: null };
  }

  const result = await foodService.getAllItems(canteenId);
  const fetchError = result.error ?? null;
  const list = result.data;

  if (!fetchError && Array.isArray(list)) {
    const entry = { data: list, timestamp: Date.now(), scopeKey };
    menuCache = entry;
    try {
      await writePersistedEntry(entry);
    } catch (_) {
      // Still serve from memory when persistence fails
    }
    return { data: list, error: null };
  }

  if (menuCache && entryValidForScope(menuCache, scopeKey)) {
    return { data: menuCache.data, error: null };
  }
  if (persisted && entryValidForScope(persisted, scopeKey)) {
    menuCache = persisted;
    return { data: persisted.data, error: null };
  }

  throwFetchError(fetchError);
}
