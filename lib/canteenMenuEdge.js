import { CONFIG } from '../config';
import { deriveItemIsAvailable } from './itemAvailability';
import { parseItemUnitPrice } from './itemPrice';
import { rememberMenuItemImages } from './ImageCache';

const TTL_MS = 45 * 1000;

/** Canonical edge URL from the Supabase dashboard. */
const CANONICAL_GET_CANTEEN_MENU_URL =
  'https://mgyfyutxtapgggcwkknw.supabase.co/functions/v1/get-canteen-menu';

/** @type {Map<string, { list: unknown[]; status: string | null; at: number }>} */
const memoryByCanteen = new Map();

export function invalidateCanteenMenuEdgeCache(canteenId = null) {
  if (canteenId == null || canteenId === '') {
    memoryByCanteen.clear();
    return;
  }
  memoryByCanteen.delete(String(canteenId));
}

function defaultMenuUrl() {
  const base = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/functions/v1/get-canteen-menu` : CANONICAL_GET_CANTEEN_MENU_URL;
}

/** Resolved URL for get-canteen-menu (override via EXPO_PUBLIC_GET_CANTEEN_MENU_URL). */
export function getCanteenMenuEdgeUrl() {
  const override = String(CONFIG.GET_CANTEEN_MENU_URL || '').trim();
  return (override || defaultMenuUrl() || CANONICAL_GET_CANTEEN_MENU_URL).replace(/\/$/, '');
}

/**
 * Normalize a row from get-canteen-menu into the shape HomeScreen / cart expect.
 */
function enrichEdgeMenuItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id != null ? String(raw.id).trim() : '';
  const name = String(raw.name ?? 'Item').trim();
  if (!id || !name) return null;

  const categories =
    typeof raw.categories === 'object' && raw.categories !== null
      ? raw.categories
      : raw.category_name
        ? {
            id: raw.category_id ?? raw.category ?? 'category-other',
            name: String(raw.category_name),
            sort_order: Number(raw.category_sort_order) || 0,
            image_url: raw.category_image_url ?? null,
          }
        : null;

  const item = {
    ...raw,
    id,
    name,
    description: typeof raw.description === 'string' ? raw.description : 'Item',
    price: parseItemUnitPrice(raw.price ?? raw.unit_price ?? raw.item_price),
    category_id:
      raw.category_id != null && raw.category_id !== ''
        ? String(raw.category_id)
        : categories?.id != null
          ? String(categories.id)
          : null,
    is_active: raw.is_active !== false,
    canteen_id:
      raw.canteen_id != null && raw.canteen_id !== '' ? String(raw.canteen_id) : null,
    image_url: typeof raw.image_url === 'string' ? raw.image_url : raw.image ?? null,
    is_vegetarian: Boolean(raw.is_vegetarian ?? raw.is_veg),
    is_available: raw.is_available ?? raw.isAvailable,
    available_stock:
      raw.available_stock != null && raw.available_stock !== ''
        ? Number(raw.available_stock)
        : raw.available_stock,
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients : [],
    preparation: Array.isArray(raw.preparation) ? raw.preparation : [],
    categories,
    calories: raw.calories ?? null,
    cooking_time: raw.cooking_time ?? null,
    spice_level: raw.spice_level ?? null,
    reviews_count: raw.reviews_count ?? null,
  };

  item.isAvailable = deriveItemIsAvailable(item);
  return item;
}

/**
 * Edge payload shapes:
 * 1) Current: `{ success, data: { menu: Category[], canteen } }` where each category has `items[]`
 * 2) Legacy: flat `menu` / `items` / `data` arrays of food rows
 */
function parseEdgeMenuResponse(body) {
  if (!body || typeof body !== 'object') {
    return { rows: null, status: null };
  }

  const payload =
    body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : body;

  const canteen = payload.canteen && typeof payload.canteen === 'object' ? payload.canteen : null;
  const status =
    canteen && canteen.is_open === false
      ? 'closed'
      : typeof body.status === 'string'
        ? body.status
        : canteen
          ? 'open'
          : null;

  // Category tree with nested items (current get-canteen-menu Redis cache shape)
  if (Array.isArray(payload.menu) && payload.menu.some((c) => c && Array.isArray(c.items))) {
    const rows = [];
    for (const cat of payload.menu) {
      if (!cat || cat.is_deleted === true) continue;
      const catItems = Array.isArray(cat.items) ? cat.items : [];
      for (const raw of catItems) {
        if (!raw || typeof raw !== 'object') continue;
        rows.push({
          ...raw,
          category_id: raw.category_id != null ? raw.category_id : cat.id,
          categories: {
            id: cat.id,
            name: cat.name,
            sort_order: Number(cat.sort_order) || 0,
            image_url: cat.image_url ?? null,
          },
        });
      }
    }
    return { rows, status };
  }

  // Flat arrays
  let flat = null;
  if (Array.isArray(payload.menu)) flat = payload.menu;
  else if (Array.isArray(payload.items)) flat = payload.items;
  else if (Array.isArray(payload.data)) flat = payload.data;
  else if (Array.isArray(body.menu)) flat = body.menu;
  else if (Array.isArray(body.items)) flat = body.items;
  else if (Array.isArray(body.data)) flat = body.data;
  else if (Array.isArray(body)) flat = body;

  return { rows: flat, status };
}

/**
 * GET /functions/v1/get-canteen-menu?canteen_id=…
 * @returns {Promise<{ list: unknown[]; status: string | null }>}
 */
async function loadMenuFromEdge(canteenId, forceRefresh = false) {
  const cid = canteenId != null && canteenId !== '' ? String(canteenId) : '';
  if (!cid) {
    throw new Error('canteen_id is required for get-canteen-menu');
  }

  const cached = memoryByCanteen.get(cid);
  if (
    !forceRefresh &&
    cached &&
    Array.isArray(cached.list) &&
    Date.now() - cached.at < TTL_MS
  ) {
    return { list: cached.list, status: cached.status };
  }

  const base = getCanteenMenuEdgeUrl();
  if (!base) {
    throw new Error('GET_CANTEEN_MENU_URL / EXPO_PUBLIC_SUPABASE_URL not configured');
  }

  // Edge function expects snake_case `canteen_id` (camelCase returns 400).
  const url = `${base}?canteen_id=${encodeURIComponent(cid)}`;
  const headers = { Accept: 'application/json' };
  const anon = String(CONFIG.SUPABASE_ANON_KEY || '').trim();
  if (anon) {
    headers.Authorization = `Bearer ${anon}`;
    headers.apikey = anon;
  }

  const res = await fetch(url, { method: 'GET', headers });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error(e?.message || 'Invalid JSON from get-canteen-menu');
  }

  if (!res.ok) {
    const msg =
      (body && (body.message || body.error)) ||
      res.statusText ||
      `HTTP ${res.status}`;
    throw new Error(String(msg));
  }

  if (body && body.success === false) {
    throw new Error(String(body.message || body.error || 'get-canteen-menu failed'));
  }

  const { rows, status } = parseEdgeMenuResponse(body);
  if (!rows) {
    throw new Error('get-canteen-menu response must include a menu array');
  }

  const list = rows.map(enrichEdgeMenuItem).filter(Boolean);
  memoryByCanteen.set(cid, { list, status, at: Date.now() });
  rememberMenuItemImages(list).catch(() => {});
  return { list, status };
}

/**
 * @returns {Promise<{ data: unknown[]; error: null; status: string | null } | { data: []; error: { message: string }; status: null }>}
 */
export async function getEdgeMenuItemsFiltered(
  categoryId = null,
  canteenId = null,
  forceRefresh = false
) {
  try {
    const { list, status } = await loadMenuFromEdge(canteenId, forceRefresh);
    let rows = [...list];
    if (categoryId != null && categoryId !== '') {
      const cat = String(categoryId);
      rows = rows.filter((r) => String(r?.category_id || '') === cat);
    }
    rows.sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));
    return { data: rows, error: null, status };
  } catch (e) {
    return {
      data: [],
      error: { message: e?.message || String(e) },
      status: null,
    };
  }
}

/**
 * Client-side paging over the edge-backed full menu list.
 *
 * @returns {Promise<{ data: unknown[]; error: unknown | null; hasMore: boolean; status: string | null }>}
 */
export async function getEdgeMenuItemsPage(
  categoryId = null,
  canteenId = null,
  offset = 0,
  pageSize = 10,
  forceRefresh = false
) {
  const { data: rows, error, status } = await getEdgeMenuItemsFiltered(
    categoryId,
    canteenId,
    forceRefresh
  );
  if (error) {
    return { data: [], error, hasMore: false, status };
  }

  const ps = Number.isFinite(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 10;
  const from = Math.max(0, Math.floor(offset));
  const slice = rows.slice(from, from + ps);
  const hasMore = from + slice.length < rows.length;
  return { data: slice, error: null, hasMore, status };
}
