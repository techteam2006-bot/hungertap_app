import { CONFIG } from '../config';
import { deriveItemIsAvailable } from './itemAvailability';
import { parseItemUnitPrice } from './itemPrice';

const TTL_MS = 45 * 1000;

/** @type {{ list: unknown[] | null; at: number }} */
let memory = { list: null, at: 0 };

export function invalidateHttpMenuCache() {
  memory = { list: null, at: 0 };
}

function envFlag(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/** When true, `foodService` loads menu rows from HTTP instead of Supabase `items`. */
export function menuFromHttpEnabled() {
  return envFlag(process.env.EXPO_PUBLIC_MENU_FROM_HTTP);
}

/**
 * Normalize a row from `/api/menu` into the shape `HomeScreen` / cart expect (`items`-like).
 */
function enrichHttpMenuRow(raw) {
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

async function loadMenuJsonFromBackend(forceRefresh = false) {
  const url = CONFIG.MENU_HTTP_URL;
  if (!url || typeof url !== 'string') {
    throw new Error('MENU_HTTP_URL / EXPO_PUBLIC_MENU_HTTP_URL not configured');
  }

  if (
    !forceRefresh &&
    memory.list &&
    Array.isArray(memory.list) &&
    Date.now() - memory.at < TTL_MS
  ) {
    return memory.list;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Menu HTTP ${res.status}: ${res.statusText || ''}`);
  }

  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error(e?.message || 'Invalid JSON from menu API');
  }

  const rows = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray(body.data)
      ? body.data
      : body && typeof body === 'object' && Array.isArray(body.items)
        ? body.items
        : null;

  if (!rows) {
    throw new Error('Menu API response must be a JSON array or { data/items: [] }');
  }

  const list = rows.map(enrichHttpMenuRow).filter(Boolean);
  memory = { list, at: Date.now() };
  return list;
}

/**
 * @returns {Promise<{ data: unknown[]; error: null } | { data: []; error: { message: string } }>}
 */
export async function getHttpMenuItemsFiltered(categoryId = null, canteenId = null, forceRefresh = false) {
  if (!menuFromHttpEnabled()) {
    return { data: [], error: { message: 'HTTP menu disabled' } };
  }
  try {
    const all = await loadMenuJsonFromBackend(forceRefresh);
    let rows = [...all];
    if (canteenId != null && canteenId !== '') {
      const c = String(canteenId);
      rows = rows.filter((r) => r?.canteen_id == null || String(r.canteen_id) === c);
    }
    if (categoryId != null && categoryId !== '') {
      const cat = String(categoryId);
      rows = rows.filter((r) => String(r?.category_id || '') === cat);
    }
    rows.sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));
    return { data: rows, error: null };
  } catch (e) {
    return { data: [], error: { message: e?.message || String(e) } };
  }
}

/**
 * Client-side paging over the HTTP-backed list (full list fetched from `/api/menu` then cached briefly).
 *
 * @returns {Promise<{ data: unknown[], error: unknown|null, hasMore: boolean }>}
 */
export async function getHttpMenuItemsPage(
  categoryId = null,
  canteenId = null,
  offset = 0,
  pageSize = 10,
  forceRefresh = false
) {
  const { data: rows, error } = await getHttpMenuItemsFiltered(
    categoryId,
    canteenId,
    forceRefresh
  );
  if (error) {
    return { data: [], error, hasMore: false };
  }

  const ps = Number.isFinite(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 10;
  const from = Math.max(0, Math.floor(offset));
  const slice = rows.slice(from, from + ps);
  const hasMore = from + slice.length < rows.length;
  return { data: slice, error: null, hasMore };
}
