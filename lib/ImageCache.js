import { Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const URI_LIST_KEY = 'hungertap_image_uri_cache_v1';
const URI_TO_FILE_KEY = 'hungertap_image_file_map_v1';
const MAX_PERSISTED_URIS = 400;

const CACHE_DIR = `${FileSystem.cacheDirectory || ''}hungertap-images/`;

/** In-memory: remote URI → local file URI (or true if only prefetched). */
const imageCache = new Map();

let hydratePromise = null;
let dirReady = false;

function safeFileNameFromUri(uri) {
  let hash = 0;
  const s = String(uri);
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  const extMatch = s.match(/\.(jpe?g|png|webp|gif|avif)(\?|$)/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'img';
  return `img_${Math.abs(hash)}.${ext}`;
}

async function ensureCacheDir() {
  if (dirReady || !FileSystem.cacheDirectory) return;
  try {
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
    dirReady = true;
  } catch (_) {}
}

async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

async function writeJson(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

async function readPersistedUris() {
  const parsed = await readJson(URI_LIST_KEY, []);
  return Array.isArray(parsed) ? parsed.filter((u) => typeof u === 'string' && u.length > 0) : [];
}

async function readFileMap() {
  const parsed = await readJson(URI_TO_FILE_KEY, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

async function persistUriIndex(uris, fileMap) {
  const unique = [...new Set(uris)].slice(-MAX_PERSISTED_URIS);
  await writeJson(URI_LIST_KEY, unique);
  if (fileMap) await writeJson(URI_TO_FILE_KEY, fileMap);
}

/**
 * Download a remote image into the app cache directory and return a local file:// URI.
 * Falls back to the remote URI if download fails.
 */
export async function cacheImageToDisk(remoteUri) {
  if (!remoteUri || typeof remoteUri !== 'string' || !remoteUri.startsWith('http')) {
    return remoteUri || null;
  }
  if (imageCache.has(remoteUri) && typeof imageCache.get(remoteUri) === 'string') {
    return imageCache.get(remoteUri);
  }

  await ensureCacheDir();
  if (!FileSystem.cacheDirectory) {
    imageCache.set(remoteUri, true);
    await Image.prefetch(remoteUri).catch(() => {});
    return remoteUri;
  }

  const fileMap = await readFileMap();
  const existing = fileMap[remoteUri];
  if (existing) {
    try {
      const info = await FileSystem.getInfoAsync(existing);
      if (info.exists) {
        imageCache.set(remoteUri, existing);
        return existing;
      }
    } catch (_) {}
  }

  const localPath = `${CACHE_DIR}${safeFileNameFromUri(remoteUri)}`;
  try {
    const result = await FileSystem.downloadAsync(remoteUri, localPath);
    const localUri = result?.uri || localPath;
    imageCache.set(remoteUri, localUri);
    fileMap[remoteUri] = localUri;
    const uris = await readPersistedUris();
    await persistUriIndex([...uris, remoteUri], fileMap);
    return localUri;
  } catch (_) {
    imageCache.set(remoteUri, true);
    await Image.prefetch(remoteUri).catch(() => {});
    return remoteUri;
  }
}

/** Resolve display source: prefer local file if cached. */
export function getCachedImageUri(remoteUri) {
  if (!remoteUri) return null;
  const hit = imageCache.get(remoteUri);
  if (typeof hit === 'string') return hit;
  return remoteUri;
}

/**
 * Remember + download remote image URIs (items, categories, banners).
 */
export async function rememberImageUris(uris = []) {
  const list = (Array.isArray(uris) ? uris : [uris])
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => u.startsWith('http'));
  if (!list.length) return;

  const existing = await readPersistedUris();
  await persistUriIndex([...existing, ...list], await readFileMap());

  // Download sequentially in small batches to avoid flooding the network
  const batchSize = 6;
  for (let i = 0; i < list.length; i += batchSize) {
    const slice = list.slice(i, i + batchSize);
    await Promise.all(slice.map((uri) => cacheImageToDisk(uri)));
  }
}

/** Extract image URLs from menu items + nested category images. */
export async function rememberMenuItemImages(items = []) {
  if (!Array.isArray(items) || !items.length) return;
  const uris = [];
  for (const item of items) {
    const u = item?.image_url || item?.image;
    if (typeof u === 'string' && u.startsWith('http')) uris.push(u);
    const cu = item?.categories?.image_url || item?.category_image_url;
    if (typeof cu === 'string' && cu.startsWith('http')) uris.push(cu);
  }
  await rememberImageUris(uris);
}

export async function rememberCategoryImages(categories = []) {
  if (!Array.isArray(categories) || !categories.length) return;
  const uris = [];
  for (const cat of categories) {
    const u = cat?.image_url || cat?.image;
    if (typeof u === 'string' && u.startsWith('http')) uris.push(u);
  }
  await rememberImageUris(uris);
}

export const configureImageCache = () => {
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    await ensureCacheDir();
    const stored = await readPersistedUris();
    const fileMap = await readFileMap();
    for (const [remote, local] of Object.entries(fileMap)) {
      if (typeof local === 'string') {
        try {
          const info = await FileSystem.getInfoAsync(local);
          if (info.exists) imageCache.set(remote, local);
        } catch (_) {}
      }
    }
    const batchSize = 8;
    for (let i = 0; i < stored.length; i += batchSize) {
      const slice = stored.slice(i, i + batchSize);
      await Promise.all(slice.map((uri) => cacheImageToDisk(uri)));
    }
  })().catch(() => {});

  return hydratePromise;
};

export const preloadImage = (uri) => {
  if (!uri) return Promise.resolve();
  return cacheImageToDisk(uri).then(() => undefined);
};

export const isImageCached = (uri) => {
  const hit = imageCache.get(uri);
  return hit === true || typeof hit === 'string';
};

export const clearImageCache = async () => {
  imageCache.clear();
  try {
    await AsyncStorage.multiRemove([URI_LIST_KEY, URI_TO_FILE_KEY]);
  } catch (_) {}
  try {
    if (FileSystem.cacheDirectory) {
      const info = await FileSystem.getInfoAsync(CACHE_DIR);
      if (info.exists) await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
      dirReady = false;
    }
  } catch (_) {}
};
