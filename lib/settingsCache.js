/**
 * Offline-first device settings + soft network caches (theme, veg, notifications,
 * splash, canteen status, profile snapshot).
 *
 * Preference keys are source-of-truth on device (no TTL).
 * Network-backed snapshots (canteen status, profile) use TTL + stale fallback.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const ENTRY_VERSION = 1;
const STATUS_TTL_MS = 2 * 60 * 1000;
const PROFILE_TTL_MS = 10 * 60 * 1000;

// Preference keys (device-global — same as historical keys for migration)
const KEY_THEME = 'theme';
const KEY_VEG = 'vegMode';
const KEY_VEG_CUSTOMIZE = 'vegModeCustomize';
const KEY_VEG_DAYS = 'vegModeSelectedDays';
const KEY_NOTIFICATIONS = 'notificationsEnabled';
const KEY_SPLASH = 'splashShown';

const KEY_CANTEEN_STATUS_PREFIX = 'settings_canteen_status_v1_';
const KEY_PROFILE_PREFIX = 'settings_profile_v1_';

/** @type {Map<string, unknown>} */
const memoryPrefs = new Map();
/** @type {Map<string, object>} */
const memorySnapshots = new Map();

function cacheLog(event, extra) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (extra && Object.keys(extra).length) {
    console.log(`[SettingsCache] ${event}`, extra);
  } else {
    console.log(`[SettingsCache] ${event}`);
  }
}

async function readRaw(key) {
  if (memoryPrefs.has(key)) {
    cacheLog('CACHE HIT (Memory)', { key });
    return memoryPrefs.get(key);
  }
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) {
      cacheLog('CACHE MISS', { key });
      return null;
    }
    memoryPrefs.set(key, raw);
    cacheLog('CACHE HIT (AsyncStorage)', { key });
    return raw;
  } catch (e) {
    cacheLog('CACHE MISS', { key, message: e?.message });
    return null;
  }
}

async function writeRaw(key, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  memoryPrefs.set(key, str);
  try {
    await AsyncStorage.setItem(key, str);
    cacheLog('CACHE SAVED', { key });
  } catch (e) {
    cacheLog('CACHE SAVED', { key, failed: true, message: e?.message });
  }
}

async function removeRaw(key) {
  memoryPrefs.delete(key);
  try {
    await AsyncStorage.removeItem(key);
  } catch (_) {}
}

function parseJson(raw, fallback) {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ─── Theme ───────────────────────────────────────────────────────────────────

/** @returns {Promise<'light'|'dark'>} */
export async function getThemePreference() {
  const raw = await readRaw(KEY_THEME);
  if (raw === 'dark' || raw === 'light') return raw;
  return 'light';
}

/** @param {boolean} isDark */
export async function setThemePreference(isDark) {
  await writeRaw(KEY_THEME, isDark ? 'dark' : 'light');
}

// ─── Veg mode ────────────────────────────────────────────────────────────────

export async function getVegMode() {
  return parseJson(await readRaw(KEY_VEG), false) === true;
}

export async function setVegMode(enabled) {
  await writeRaw(KEY_VEG, JSON.stringify(Boolean(enabled)));
}

export async function getVegModeCustomize() {
  return parseJson(await readRaw(KEY_VEG_CUSTOMIZE), false) === true;
}

export async function setVegModeCustomize(enabled) {
  await writeRaw(KEY_VEG_CUSTOMIZE, JSON.stringify(Boolean(enabled)));
}

export async function getVegModeSelectedDays() {
  const v = parseJson(await readRaw(KEY_VEG_DAYS), null);
  return v && typeof v === 'object' ? v : null;
}

export async function setVegModeSelectedDays(days) {
  await writeRaw(KEY_VEG_DAYS, JSON.stringify(days || {}));
}

// ─── Notifications ───────────────────────────────────────────────────────────

/** Default ON when unset (matches existing app behavior). */
export async function getNotificationsEnabled() {
  const raw = await readRaw(KEY_NOTIFICATIONS);
  if (raw == null) return true;
  return parseJson(raw, true) === true;
}

export async function setNotificationsEnabled(enabled) {
  await writeRaw(KEY_NOTIFICATIONS, JSON.stringify(Boolean(enabled)));
}

// ─── Splash ──────────────────────────────────────────────────────────────────

export async function getSplashShown() {
  const raw = await readRaw(KEY_SPLASH);
  return raw === 'true';
}

export async function setSplashShown(shown = true) {
  await writeRaw(KEY_SPLASH, shown ? 'true' : 'false');
}

// ─── Snapshot helpers (TTL) ──────────────────────────────────────────────────

function snapshotKey(prefix, id) {
  return `${prefix}${id}`;
}

function isFreshSnapshot(entry, ttlMs) {
  if (!entry || typeof entry.updatedAt !== 'number') return false;
  const expiresAt =
    typeof entry.expiresAt === 'number' ? entry.expiresAt : entry.updatedAt + ttlMs;
  return Date.now() < expiresAt;
}

async function readSnapshot(key) {
  const mem = memorySnapshots.get(key);
  if (mem) {
    cacheLog('CACHE HIT (Memory)', { key });
    return mem;
  }
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      cacheLog('CACHE MISS', { key });
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    memorySnapshots.set(key, parsed);
    cacheLog('CACHE HIT (AsyncStorage)', { key });
    return parsed;
  } catch {
    return null;
  }
}

async function writeSnapshot(key, data, ttlMs) {
  const now = Date.now();
  const entry = {
    version: ENTRY_VERSION,
    updatedAt: now,
    expiresAt: now + ttlMs,
    data,
  };
  memorySnapshots.set(key, entry);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
    cacheLog('CACHE SAVED', { key });
  } catch (e) {
    cacheLog('CACHE SAVED', { key, failed: true, message: e?.message });
  }
  return entry;
}

// ─── Canteen status (last known open/closed) ─────────────────────────────────

/**
 * @param {string} scopeId - canteenId or userId
 * @returns {Promise<{ isOpen: boolean, statusKnownFromServer: boolean, closureReason?: string|null }|null>}
 */
export async function getCachedCanteenStatus(scopeId) {
  if (!scopeId) return null;
  const entry = await readSnapshot(snapshotKey(KEY_CANTEEN_STATUS_PREFIX, scopeId));
  if (!entry?.data || typeof entry.data.isOpen !== 'boolean') return null;
  return {
    isOpen: entry.data.isOpen,
    statusKnownFromServer: true,
    closureReason: entry.data.closureReason || null,
    stale: !isFreshSnapshot(entry, STATUS_TTL_MS),
  };
}

/** @param {string} scopeId @param {boolean} isOpen @param {'kitchen_closed'|'orders_paused'|null} [closureReason] */
export async function setCachedCanteenStatus(scopeId, isOpen, closureReason = null) {
  if (!scopeId) return;
  await writeSnapshot(
    snapshotKey(KEY_CANTEEN_STATUS_PREFIX, scopeId),
    { isOpen: !!isOpen, closureReason: closureReason || null },
    STATUS_TTL_MS
  );
}

export async function clearCachedCanteenStatus(scopeId) {
  if (!scopeId) return;
  const key = snapshotKey(KEY_CANTEEN_STATUS_PREFIX, scopeId);
  memorySnapshots.delete(key);
  await removeRaw(key);
}

// ─── Profile snapshot (offline role / canteen_id) ────────────────────────────

/**
 * @param {string} userId
 * @returns {Promise<object|null>} last users-row-like object
 */
export async function getCachedProfile(userId) {
  if (!userId) return null;
  const entry = await readSnapshot(snapshotKey(KEY_PROFILE_PREFIX, userId));
  if (!entry?.data || typeof entry.data !== 'object') return null;
  return entry.data;
}

/** @param {string} userId @param {object} profile */
export async function setCachedProfile(userId, profile) {
  if (!userId || !profile) return;
  await writeSnapshot(snapshotKey(KEY_PROFILE_PREFIX, userId), profile, PROFILE_TTL_MS);
}

export async function clearCachedProfile(userId) {
  if (!userId) return;
  const key = snapshotKey(KEY_PROFILE_PREFIX, userId);
  memorySnapshots.delete(key);
  await removeRaw(key);
}

/** Warm memory from AsyncStorage for common prefs (call once at app start). */
export async function preloadSettingsCache() {
  await Promise.all([
    getThemePreference(),
    getVegMode(),
    getNotificationsEnabled(),
    getSplashShown(),
  ]);
}
