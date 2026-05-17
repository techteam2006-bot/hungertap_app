import { ITEM_IMAGE_FALLBACK } from './appLogo';
import { CONFIG } from '../config';

function isTruthyString(raw) {
  if (raw == null) return false;
  const s = String(raw).trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === 'none') return false;
  return true;
}

/** Accept only strings that look like a loadable remote/local URI for Image. */
export function isLikelyImageUrl(s) {
  if (!isTruthyString(s)) return false;
  const t = String(s).trim();
  const lower = t.toLowerCase();
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('file://') ||
    lower.startsWith('data:image') ||
    lower.startsWith('content://')
  );
}

function absolutizeIfNeeded(candidate) {
  let t = String(candidate).trim();
  if (!t) return null;
  if (t.startsWith('//')) return `https:${t}`;
  if (t.startsWith('/') && t.length > 1 && CONFIG?.SUPABASE_URL) {
    const base = String(CONFIG.SUPABASE_URL).replace(/\/$/, '');
    return `${base}${t}`;
  }
  return t;
}

/**
 * First usable image URL from an item (common field names).
 * @returns {string|null}
 */
export function getItemImageUri(item) {
  const candidates = [
    item?.image_url,
    item?.imageUrl,
    item?.imageURL,
    item?.image,
    item?.photo_url,
    item?.photoUrl,
    item?.thumbnail,
    item?.thumbnail_url,
  ];
  for (const raw of candidates) {
    if (!isTruthyString(raw)) continue;
    const candidate = absolutizeIfNeeded(String(raw).trim());
    if (candidate && isLikelyImageUrl(candidate)) return candidate;
  }
  return null;
}

/**
 * React Native `Image` source: remote `{ uri }` or bundled HungerTap transparent logo.
 */
export function getItemImageSource(item) {
  const uri = getItemImageUri(item);
  if (uri) return { uri };
  return ITEM_IMAGE_FALLBACK;
}
