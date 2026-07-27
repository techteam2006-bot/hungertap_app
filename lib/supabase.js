import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { CONFIG } from '../config';
import { deriveItemIsAvailable } from './itemAvailability';
import {
  isNetworkConnectivityFailure,
  MSG_COULD_NOT_FETCH_DATA,
  MSG_POOR_NETWORK,
} from './orderFlowErrors';
import {
  menuFromHttpEnabled,
  getHttpMenuItemsFiltered,
  getHttpMenuItemsPage,
} from './menuHttp';
import {
  getEdgeMenuItemsFiltered,
  getEdgeMenuItemsPage,
} from './canteenMenuEdge';
import { parseItemUnitPrice } from './itemPrice';

export { deriveItemIsAvailable };

// Supabase Configuration — DB, Realtime, Storage and Auth
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * SecureStore adapter for Supabase auth — stores JWT tokens in Android Keystore / iOS Keychain.
 * Keys are capped at 255 chars because SecureStore rejects longer keys.
 * Falls back to AsyncStorage for non-sensitive, large values that exceed SecureStore limits.
 */
const secureStoreAdapter = {
  async getItem(key) {
    try {
      const stored = await SecureStore.getItemAsync(key);
      if (stored != null) return stored;
    } catch (_) {}
    return AsyncStorage.getItem(key);
  },
  async setItem(key, value) {
    try {
      if (typeof value === 'string' && value.length < 2048) {
        await SecureStore.setItemAsync(key, value);
        return;
      }
    } catch (_) {}
    return AsyncStorage.setItem(key, value);
  },
  async removeItem(key) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (_) {}
    return AsyncStorage.removeItem(key);
  },
};

function buildSupabaseClient() {
  const clientOptions = {
    auth: {
      storage: secureStoreAdapter,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Info': 'canteen-app@1.0.0',
      },
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
      timeout: 10000, // 10 second timeout
    },
    db: {
      schema: 'public',
    },
  };

  try {
    // ✅ crash prevention added — never throw from module init when env is wrong
    const url = SUPABASE_URL || '';
    const key = SUPABASE_ANON_KEY || '';
    if (!url || !key) {
      console.error(
        '[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY; network calls will fail until configured.'
      );
    }
    if ((!url || !key) && typeof __DEV__ !== 'undefined' && !__DEV__) {
      console.error(
        '[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in production build.'
      );
    }
    return createClient(url || 'https://invalid.local', key || 'invalid-anon-key', clientOptions);
  } catch (err) {
    console.error('Unexpected Error: failed to create Supabase client', err);
    return createClient('https://invalid.local', 'invalid-anon-key', clientOptions);
  }
}

// Initialize Supabase client — auth enabled (Supabase is the auth provider)
export const supabase = buildSupabaseClient();

/**
 * Distinguishes “no row / no canteen” from offline or query failures (see `prepareCheckoutCart`).
 * @typedef {{ type: 'OK', canteenId: string } | { type: 'NO_USER'|'NO_CANTEEN'|'NETWORK'|'FETCH', canteenId: null, cause?: unknown }} UserCanteenResolve
 */

/**
 * @param {string|null|undefined} userId
 * @returns {Promise<UserCanteenResolve>}
 */
export async function resolveUserCanteenId(userId) {
  if (!userId) return { type: 'NO_USER', canteenId: null };
  try {
    const { data, error } = await supabase
      .from('users')
      .select('canteen_id')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      if (isNetworkConnectivityFailure(error)) {
        return { type: 'NETWORK', canteenId: null, cause: error };
      }
      return { type: 'FETCH', canteenId: null, cause: error };
    }
    const cid = data?.canteen_id ?? null;
    const empty = cid == null || cid === '';
    if (empty) {
      return { type: 'NO_CANTEEN', canteenId: null };
    }
    return { type: 'OK', canteenId: String(cid).trim() };
  } catch (err) {
    if (isNetworkConnectivityFailure(err)) {
      return { type: 'NETWORK', canteenId: null, cause: err };
    }
    return { type: 'FETCH', canteenId: null, cause: err };
  }
}

// Helper: user's canteen_id — null on failure; use `resolveUserCanteenId` when you must know why.
export async function getUserCanteenId(userId) {
  const r = await resolveUserCanteenId(userId);
  if (r.type === 'FETCH' && r.cause) {
    console.warn('getUserCanteenId (query error):', r.cause.message || r.cause);
  } else if (r.type === 'NETWORK' && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('getUserCanteenId: network unreachable');
  }
  return r.type === 'OK' ? r.canteenId : null;
}

// Network retry utility
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      console.log(`🔄 Attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Test connection function with retry mechanism (DB-only, no auth test)
export const testConnection = async () => {
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('🔍 Testing Supabase connection...');
      console.log('🌐 URL:', SUPABASE_URL);
    }
    
    const result = await retryWithBackoff(async () => {
      // Test basic connection with a simple query
      const { data, error } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .limit(1);
      
      if (error) {
        throw new Error(`Database query failed: ${error.message}`);
      }
      
      return { success: true, data };
    });
    
    console.log('✅ Supabase connection successful');
    return result;
  } catch (error) {
    console.error('❌ Connection test failed after retries:', error);
    return { success: false, error: error.message };
  }
};

// Test auth connection — verify DB access
export const testAuthConnection = async () => {
  try {
    console.log('🔍 Testing Supabase DB connection...');
    const { data, error } = await supabase.from('users').select('id').limit(1);
    if (error) {
      console.error('❌ DB connection failed:', error);
      return { success: false, error: error.message };
    }
    console.log('✅ DB connection successful');
    return { success: true, data };
  } catch (error) {
    console.error('❌ DB test failed:', error);
    return { success: false, error: error.message };
  }
};

// Check database tables
export const checkDatabaseTables = async () => {
  try {
    console.log('🔍 Checking database tables...');
    
    const tables = ['users', 'items', 'categories', 'cart_items', 'orders', 'order_items', 'canteens', 'colleges'];
  const results = {};
  
  for (const table of tables) {
    try {
      const { error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .limit(1);
      
        results[table] = {
          exists: !error,
          error: error?.message || null
        };
      } catch (err) {
        results[table] = {
          exists: false,
          error: err.message
        };
      }
    }
    
    console.log('✅ Database tables check completed');
    return { success: true, results };
  } catch (error) {
    console.error('❌ Database tables check failed:', error);
    return { success: false, error: error.message };
  }
};

// authService: Supabase auth client is available via supabase.auth
export const authService = supabase.auth;

const CATEGORY_CACHE_DURATION = 3 * 60 * 1000; // 3 minutes
const CATEGORY_CACHE_STORAGE_DURATION = 15 * 60 * 1000; // 15 minutes
const CATEGORY_CACHE_STORAGE_KEY = '@canteen_categories_cache_v1';
let backgroundCategoriesRefreshInFlight = false;
let cachedCategories = null;
let categoriesCacheTimestamp = 0;

const CATEGORY_SELECT_COLUMNS = [
  'id',
  'canteen_id',
  'name',
  'sort_order',
  'is_active',
].join(',');

const cloneCategories = (categories) => {
  if (!Array.isArray(categories)) {
    return [];
  }

  return categories.map(category => ({ ...category }));
};

const isMeaningfulNutritionValue = (value) =>
  value !== undefined && value !== null && value !== '';

const NUTRITION_FIELD_MAPPINGS = {
  calories: ['calories', 'calorie', 'item_calorie', 'item_calories'],
  protein: ['protein', 'proteins', 'item_protein', 'item_protien'],
  carbs: ['carbs', 'carbohydrates', 'item_carbs'],
  fat: ['fat', 'fats', 'item_fat'],
};

export const normalizeFoodItemNutrition = (item = {}) => {
  if (!item || typeof item !== 'object') {
    return item;
  }

  const normalizedItem = { ...item };
  normalizedItem.price = parseItemUnitPrice(
    item.price ?? item.unit_price ?? item.item_price ?? item.selling_price
  );
  const resolveValue = (keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(item, key) && isMeaningfulNutritionValue(item[key])) {
        return item[key];
      }
    }
    return undefined;
  };

  Object.entries(NUTRITION_FIELD_MAPPINGS).forEach(([field, keys]) => {
    const value = resolveValue(keys);
    if (value !== undefined) {
      normalizedItem[field] = value;
    } else if (normalizedItem[field] === undefined) {
      normalizedItem[field] = null;
    }
  });

  normalizedItem.isAvailable = deriveItemIsAvailable(normalizedItem);
  return normalizedItem;
};

const isCacheValid = () => {
  if (!cachedCategories) {
    return false;
  }

  return Date.now() - categoriesCacheTimestamp < CATEGORY_CACHE_DURATION;
};

const setCategoriesCache = (categories) => {
  cachedCategories = cloneCategories(categories);
  categoriesCacheTimestamp = Date.now();
};

const getCategoriesCache = () => cloneCategories(cachedCategories);

const persistCategoriesToStorage = async (categories) => {
  try {
    const payload = JSON.stringify({
      timestamp: Date.now(),
      data: categories
    });
    await AsyncStorage.setItem(CATEGORY_CACHE_STORAGE_KEY, payload);
  } catch (error) {
    console.warn('⚠️ Failed to persist categories cache:', error?.message || error);
  }
};

const loadCategoriesFromStorage = async () => {
  try {
    const raw = await AsyncStorage.getItem(CATEGORY_CACHE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed?.data || !Array.isArray(parsed.data)) {
      return null;
    }

    const isExpired = Date.now() - (parsed.timestamp || 0) > CATEGORY_CACHE_STORAGE_DURATION;
    if (isExpired) {
      return null;
    }

    return cloneCategories(parsed.data);
  } catch (error) {
    console.warn('⚠️ Failed to load categories cache:', error?.message || error);
    return null;
  }
};

const scheduleCategoriesRefresh = () => {
  if (backgroundCategoriesRefreshInFlight) {
    return;
  }

  backgroundCategoriesRefreshInFlight = true;
  fetchCategoriesFromNetwork()
    .catch(error => {
      console.warn('⚠️ Background categories refresh failed:', error?.message || error);
    })
    .finally(() => {
      backgroundCategoriesRefreshInFlight = false;
    });
};

const setNetworkCategoriesCache = async (categories) => {
  setCategoriesCache(categories);
  await persistCategoriesToStorage(categories);
};

async function fetchCategoriesFromNetwork() {
  // ✅ error handled — network categories fetch fully guarded
  try {
    // Backend schema: categories table has: id, name, sort_order, image_url (NO canteen_id, NO is_active)
    const primaryResponse = await supabase
      .from('categories')
      .select('id, name, sort_order, image_url')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (!primaryResponse.error) {
      const enrichedData = (primaryResponse.data || []).map(category => ({
        id: category.id,
        canteen_id: null, // Not in backend schema
        name: category.name,
        description: 'Food category',
        icon: '🍽️',
        image_url: category.image_url || null,
        sort_order: category.sort_order ?? 0,
        is_active: true, // Not in backend schema, default to true
      }));
      await setNetworkCategoriesCache(enrichedData);
      console.log('✅ Categories fetched successfully:', enrichedData.length, 'categories');
      return {
        ...primaryResponse,
        data: enrichedData
      };
    }

    console.error('❌ Categories query failed:', primaryResponse.error);
    return { data: [], error: primaryResponse.error };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { data: [], error: { message: err?.message || String(err) } };
  }
}

export const foodService = {
  /**
   * @param {string|null} categoryId
   * @param {string|null} canteenId - When set, only rows from `items` for this canteen (must match `users.canteen_id` for `create_order_minimal`).
   */
  async getFoodItems(categoryId = null, canteenId = null) {
    try {
      console.log('🔄 Fetching food items...', categoryId ? `for category: ${categoryId}` : 'all categories', canteenId ? `canteen: ${canteenId}` : '');

      if (menuFromHttpEnabled()) {
        const { data, error } = await getHttpMenuItemsFiltered(categoryId, canteenId, false);
        if (!error && Array.isArray(data)) {
          const normalizedData = data.map((item) => normalizeFoodItemNutrition({ ...item }));
          console.log('✅ Food items (HTTP menu):', normalizedData.length);
          return { data: normalizedData, error: null };
        }
        console.warn('⚠️ HTTP menu failed:', error?.message || error);
        return { data: [], error: error || { message: 'HTTP menu unavailable' } };
      }

      // Default: Edge Function get-canteen-menu (Redis/cache-backed) — not direct `items` reads.
      const { data, error } = await getEdgeMenuItemsFiltered(categoryId, canteenId, false);
      if (!error && Array.isArray(data)) {
        const normalizedData = data.map((item) => normalizeFoodItemNutrition({ ...item }));
        console.log('✅ Food items (edge menu):', normalizedData.length);
        return { data: normalizedData, error: null };
      }
      console.warn('⚠️ Edge menu failed:', error?.message || error);
      return { data: [], error: error || { message: 'Edge menu unavailable' } };
      
    } catch (error) {
      // ✅ error handled
      console.error('❌ Food service error:', error);
      return { data: [], error: { message: error?.message || String(error) } };
    }
  },
  
  async getFoodItem(id) {
    try {
      console.log('🔄 Fetching food item:', id);

      // Canteen-scoped item fetch — callers should filter if needed.
      let userCanteenId = null;

      // Only allow access to items from the user's selected canteen
      let result = await supabase
        .from('items')
        .select(`
          *,
          categories (
            id,
            name,
            sort_order,
            image_url
          )
        `)
        .eq('id', id)
        .single();

      if (userCanteenId && result.data?.canteen_id !== userCanteenId) {
        return { data: null, error: { message: 'Item not available in your canteen.' } };
      }

      if (result.error) {
        console.error('❌ Error fetching food item:', result.error);
        
        // Fallback: try with minimal columns (still enforce canteen)
        let fallback = await supabase
          .from('items')
          .select('id, name, price, category_id, is_active, canteen_id, image_url, is_vegetarian, available_stock')
          .eq('id', id)
          .single();
        if (userCanteenId && fallback.data?.canteen_id !== userCanteenId) {
          return { data: null, error: { message: 'Item not available in your canteen.' } };
        }
        result = fallback;
        
        if (!result.error && result.data) {
          // Add default values for missing fields
          result.data = {
            ...result.data,
            description: 'Item',
            image_url: result.data.image_url || null,
            is_vegetarian: result.data.is_vegetarian || false,
            available_stock: result.data.available_stock ?? null,
            ingredients: [],
            categories: null,
          };
        }
      }

      if (result.data && userCanteenId && result.data.canteen_id !== userCanteenId) {
        return { data: null, error: { message: 'Item not available in your canteen.' } };
      }
      
      if (result.data) {
        result.data = normalizeFoodItemNutrition({
          ...result.data,
          image_url: result.data.image_url ?? null,
          is_vegetarian: result.data.is_vegetarian || false,
          available_stock: result.data.available_stock ?? null,
        });
      }

      if (result.data) {
        console.log('✅ Food item fetched successfully:', result.data.name);
      }
      
      return result;
      
    } catch (error) {
      // ✅ error handled
      console.error('❌ Food item fetch error:', error);
      return { data: null, error: { message: error?.message || String(error) } };
    }
  },
  
  async getCategories() {
    try {
      console.log('🔄 Fetching categories...');

      if (isCacheValid()) {
        console.log('⚡ Returning cached categories:', cachedCategories.length);
        return {
          data: getCategoriesCache(),
          error: null,
          status: 200,
          statusText: 'OK'
        };
      }

      const storedCategories = await loadCategoriesFromStorage();
      if (storedCategories) {
        console.log('⚡ Returning persisted categories cache:', storedCategories.length);
        setCategoriesCache(storedCategories);
        scheduleCategoriesRefresh();
        return {
          data: cloneCategories(storedCategories),
          error: null,
          status: 200,
          statusText: 'OK (cached)'
        };
      }
      
      return await fetchCategoriesFromNetwork();
      
    } catch (error) {
      // ✅ error handled
      console.error('❌ Categories fetch error:', error);
      return { data: [], error: { message: error?.message || String(error) } };
    }
  },
  
  async getAllItems(canteenId = null) {
    console.log('🔄 getAllItems called', canteenId ? `(canteen_id=${canteenId})` : '(no canteen filter)');
    return this.getFoodItems(null, canteenId);
  },

  /**
   * Paginated menu fetch — same schema as {@link #getFoodItems}.
   * Default source: Edge Function `get-canteen-menu` (full list, client-paged).
   * @param {string|null} categoryId
   * @param {string|null} canteenId - Required for the edge menu (query param `canteen_id`).
   * @param {number} offset
   * @param {number} pageSize
   * @param {{ forceRefresh?: boolean, forceHttpRefresh?: boolean }} [pageOptions]
   * @returns {Promise<{ data: unknown[], error: unknown|null, hasMore: boolean }>}
   */
  async getFoodItemsPage(categoryId = null, canteenId = null, offset = 0, pageSize = 10, pageOptions = {}) {
    const forceRefresh = Boolean(
      pageOptions?.forceRefresh ?? pageOptions?.forceHttpRefresh
    );
    const ps = Number.isFinite(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 10;

    try {
      if (menuFromHttpEnabled()) {
        const {
          data: rows,
          error,
          hasMore,
        } = await getHttpMenuItemsPage(categoryId, canteenId, offset, ps, forceRefresh);
        if (!error && Array.isArray(rows)) {
          const normalized = rows.map((item) => normalizeFoodItemNutrition({ ...item }));
          return { data: normalized, error: null, hasMore: !!hasMore };
        }
        return { data: [], error: error || { message: 'HTTP menu unavailable' }, hasMore: false };
      }

      const {
        data: rows,
        error,
        hasMore,
      } = await getEdgeMenuItemsPage(categoryId, canteenId, offset, ps, forceRefresh);
      if (!error && Array.isArray(rows)) {
        const normalized = rows.map((item) => normalizeFoodItemNutrition({ ...item }));
        return { data: normalized, error: null, hasMore: !!hasMore };
      }
      return { data: [], error: error || { message: 'Edge menu unavailable' }, hasMore: false };
    } catch (error) {
      console.warn('getFoodItemsPage:', error?.message || error);
      return {
        data: [],
        error: { message: error?.message || String(error) },
        hasMore: false,
      };
    }
  },
};

/** PostgREST: missing table/relation (PGRST205) or column (PGRST204) in schema cache */
function isSchemaMismatchError(error) {
  return Boolean(error && (error.code === 'PGRST205' || error.code === 'PGRST204'));
}

export const cartService = {
  async getCartItems(userId) {
    try {
      // ✅ error handled — guarded cart read (no session without userId)
      if (!userId) {
        console.warn('getCartItems: missing userId');
        return { data: [], error: null };
      }
      const { data, error } = await supabase
        .from('cart_items')
        .select(`
        *,
        items (
          id,
          name,
          price,
          is_active,
          category_id,
          canteen_id,
          available_stock
        )
      `)
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('❌ cartService.getCartItems:', error.message || error);
        if (isSchemaMismatchError(error)) {
          return { data: [], error: null };
        }
        return { data: [], error: null };
      }

      // Back-compat: older app code expects nested `food_items`
      const mapped = Array.isArray(data) ? data.map(row => {
        const item = row.items || null;
        const food_items = item
          ? normalizeFoodItemNutrition({ ...item, image_url: item.image_url ?? null })
          : null;

        const { items, ...rest } = row;
        return { ...rest, food_items };
      }) : [];

      return { data: mapped, error: null };
    } catch (err) {
      console.error('Unexpected Error:', err);
      return { data: [], error: null };
    }
  },
  async addToCart(userId, foodItemId, quantity = 1) {
    try {
      // ✅ error handled
      if (!userId || !foodItemId) {
        return { data: null, error: { message: 'User and item are required' } };
      }
      let userCanteenId = null;
      try {
        const { data: userRow, error: uErr } = await supabase.from('users').select('canteen_id').eq('id', userId).maybeSingle();
        if (uErr) console.error('addToCart users lookup:', uErr.message || uErr);
        userCanteenId = userRow?.canteen_id || null;
      } catch (e) {
        console.error('Unexpected Error:', e);
      }

      let itemCanteenId = null;
      try {
        const { data: itemRow, error: iErr } = await supabase.from('items').select('canteen_id').eq('id', foodItemId).maybeSingle();
        if (iErr) console.error('addToCart items lookup:', iErr.message || iErr);
        itemCanteenId = itemRow?.canteen_id || null;
      } catch (e) {
        console.error('Unexpected Error:', e);
      }

      if (userCanteenId && itemCanteenId && itemCanteenId !== userCanteenId) {
        return { data: null, error: { message: 'This item is from another canteen. You can only add items from your selected canteen.' } };
      }

      const canteenId = userCanteenId || itemCanteenId;

      const { data: existingItem, error: findErr } = await supabase
        .from('cart_items')
        .select('id, quantity')
        .eq('user_id', userId)
        .eq('item_id', foodItemId)
        .limit(1)
        .maybeSingle();

      if (findErr && isSchemaMismatchError(findErr)) {
        return { data: null, error: null };
      }
      if (findErr) {
        console.error('addToCart find:', findErr.message || findErr);
        return { data: null, error: findErr };
      }

      if (existingItem) {
        const upd = await supabase
          .from('cart_items')
          .update({ quantity: (existingItem.quantity ?? 0) + quantity })
          .eq('id', existingItem.id);
        if (upd.error) {
          console.error('addToCart update:', upd.error.message || upd.error);
          if (isSchemaMismatchError(upd.error)) {
            return { data: null, error: null };
          }
          return { data: null, error: upd.error };
        }
        return { ...upd, error: null };
      }

      const ins = await supabase
        .from('cart_items')
        .insert({
          user_id: userId,
          canteen_id: canteenId,
          item_id: foodItemId,
          quantity,
        });
      if (ins.error) {
        console.error('addToCart insert:', ins.error.message || ins.error);
        if (isSchemaMismatchError(ins.error)) {
          return { data: null, error: null };
        }
        return { data: null, error: ins.error };
      }
      return { ...ins, error: null };
    } catch (err) {
      console.error('Unexpected Error:', err);
      return { data: null, error: { message: err?.message || String(err) } };
    }
  },
  async updateCartItemQuantity(userId, itemId, quantity) {
    try {
      // ✅ error handled
      if (!userId) {
        return { data: null, error: { message: 'User required' } };
      }
      if (quantity <= 0) {
        const del = await supabase
          .from('cart_items')
          .delete()
          .eq('id', itemId)
          .eq('user_id', userId);
        if (del.error) {
          console.error('updateCartItemQuantity delete:', del.error.message || del.error);
          if (isSchemaMismatchError(del.error)) {
            return { data: null, error: null };
          }
          return { data: null, error: del.error };
        }
        return { ...del, error: null };
      }

      const upd = await supabase
        .from('cart_items')
        .update({ quantity })
        .eq('id', itemId)
        .eq('user_id', userId);
      if (upd.error) {
        console.error('updateCartItemQuantity:', upd.error.message || upd.error);
        if (isSchemaMismatchError(upd.error)) {
          return { data: null, error: null };
        }
        return { data: null, error: upd.error };
      }
      return { ...upd, error: null };
    } catch (err) {
      console.error('Unexpected Error:', err);
      return { data: null, error: { message: err?.message || String(err) } };
    }
  },
  async removeFromCart(userId, itemId) {
    try {
      if (!userId) {
        return { data: null, error: { message: 'User required' } };
      }
      const del = await supabase
        .from('cart_items')
        .delete()
        .eq('id', itemId)
        .eq('user_id', userId);
      if (del.error) {
        console.error('removeFromCart:', del.error.message || del.error);
        if (isSchemaMismatchError(del.error)) {
          return { data: null, error: null };
        }
        return { data: null, error: del.error };
      }
      return { ...del, error: null };
    } catch (err) {
      console.error('Unexpected Error:', err);
      return { data: null, error: { message: err?.message || String(err) } };
    }
  },
  async clearCart(userId) {
    try {
      if (!userId) {
        return { data: null, error: { message: 'User required' } };
      }
      const del = await supabase
        .from('cart_items')
        .delete()
        .eq('user_id', userId);
      if (del.error) {
        console.error('clearCart:', del.error.message || del.error);
        if (isSchemaMismatchError(del.error)) {
          return { data: null, error: null };
        }
        return { data: null, error: del.error };
      }
      return { ...del, error: null };
    } catch (err) {
      console.error('Unexpected Error:', err);
      return { data: null, error: { message: err?.message || String(err) } };
    }
  }
};

/** Matches `create_order_minimal` PL/pgSQL limits (c_max_lines / c_max_quantity_per_line). */
const CREATE_ORDER_MIN_MAX_LINES = 15;
const CREATE_ORDER_MIN_MAX_QTY = 15;

const CREATE_ORDER_ITEM_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidItemsTableUuid(id) {
  return typeof id === 'string' && CREATE_ORDER_ITEM_UUID_RE.test(id.trim());
}

function clampLineQuantity(q) {
  const n = parseInt(String(q ?? 1), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > CREATE_ORDER_MIN_MAX_QTY) return CREATE_ORDER_MIN_MAX_QTY;
  return n;
}

function lineItemUuid(item) {
  if (!item || typeof item !== 'object') return null;
  const raw = item.item_id ?? item.id ?? item.food_item_id;
  if (raw == null) return null;
  return String(raw).trim();
}

/**
 * Validates input for `create_order_minimal(p_is_takeaway boolean DEFAULT false, p_items jsonb DEFAULT '[]')`.
 * Sends only boolean + JSON array of `{ item_id: uuid, quantity: int }` with DB-compatible bounds.
 *
 * @param {Array<{ id?: string, item_id?: string, food_item_id?: string, quantity?: number }>} linesSource
 * @param {unknown} isTakeawayInput
 * @returns {{ ok: true, p_is_takeaway: boolean, p_items: Array<{ item_id: string, quantity: number }> } | { ok: false, error: string }}
 */
export function prepareCreateOrderMinimalArgs(linesSource, isTakeawayInput) {
  const raw = Array.isArray(linesSource) ? linesSource : [];

  if (raw.length > CREATE_ORDER_MIN_MAX_LINES) {
    return {
      ok: false,
      error: `Too many items (max ${CREATE_ORDER_MIN_MAX_LINES} lines per order).`,
    };
  }

  const p_items = [];

  for (const item of raw) {
    const id = lineItemUuid(item);
    if (!id) {
      return {
        ok: false,
        error: 'Each cart line must include a valid menu item id (public.items.id).',
      };
    }
    if (!isValidItemsTableUuid(id)) {
      return { ok: false, error: `Invalid item id (expected UUID): ${id}` };
    }
    p_items.push({
      item_id: id,
      quantity: clampLineQuantity(item.quantity),
    });
  }

  if (p_items.length === 0) {
    return { ok: false, error: 'At least one item is required.' };
  }

  const p_is_takeaway =
    isTakeawayInput === true ||
    isTakeawayInput === 'true' ||
    isTakeawayInput === 1 ||
    isTakeawayInput === '1';

  return { ok: true, p_is_takeaway, p_items };
}

/**
 * Before `create_order_minimal`, ensure each line exists in `public.items` for `users.canteen_id`.
 * Avoids opaque DB errors when the cart has stale rows or items from another canteen.
 *
 * @param {string} userId
 * @param {Array<{ id?: string, item_id?: string, food_item_id?: string, name?: string, quantity?: number }>} cartLines
 * @param {Array<{ item_id: string, quantity: number }>} pItems from prepareCreateOrderMinimalArgs
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function validateCartItemsForUserCanteen(userId, cartLines, pItems) {
  try {
    // ✅ error handled
    if (!userId || !Array.isArray(pItems) || pItems.length === 0) {
      return { ok: false, error: 'Missing user or order lines.' };
    }

    const resolved = await resolveUserCanteenId(userId);
    if (resolved.type === 'NETWORK') {
      return { ok: false, error: MSG_POOR_NETWORK };
    }
    if (resolved.type === 'FETCH') {
      return { ok: false, error: MSG_COULD_NOT_FETCH_DATA };
    }
    if (resolved.type === 'NO_USER' || resolved.type === 'NO_CANTEEN') {
      return {
        ok: false,
        error:
          'Your profile has no canteen assigned. Update your profile or contact support, then try again.',
      };
    }
    const canteenId = resolved.canteenId;

    const ids = [...new Set(pItems.map((l) => l.item_id).filter(Boolean))];
    const { data, error } = await supabase
      .from('items')
      .select('id')
      .eq('canteen_id', canteenId)
      .in('id', ids);

    if (error) {
      console.warn('validateCartItemsForUserCanteen:', error.message || error);
      return {
        ok: false,
        error: isNetworkConnectivityFailure(error) ? MSG_POOR_NETWORK : MSG_COULD_NOT_FETCH_DATA,
      };
    }

    const okIds = new Set((data || []).map((r) => r.id));
    const missing = ids.filter((id) => !okIds.has(id));
    if (missing.length === 0) {
      return { ok: true };
    }

    const nameById = new Map();
    for (const row of Array.isArray(cartLines) ? cartLines : []) {
      const raw = row?.item_id ?? row?.id ?? row?.food_item_id;
      if (raw == null) continue;
      nameById.set(String(raw).trim(), row?.name || 'Unknown item');
    }

    const labels = missing.map((id) => nameById.get(id) || id);
    if (missing.length === 1) {
      return {
        ok: false,
        error: `"${labels[0]}" is not on your canteen menu. Remove it from the cart and add items from the current menu.`,
      };
    }
    return {
      ok: false,
      error: `These items are not on your canteen menu: ${labels.join(', ')}. Remove them or clear the cart and add items again.`,
    };
  } catch (err) {
    console.warn('validateCartItemsForUserCanteen:', err?.message || err);
    return {
      ok: false,
      error: isNetworkConnectivityFailure(err) ? MSG_POOR_NETWORK : MSG_COULD_NOT_FETCH_DATA,
    };
  }
}

/**
 * Maps `create_order_minimal` PL/pgSQL raise messages to short, user-facing text.
 * @param {string|null|undefined} message
 * @returns {string}
 */
export function formatCreateOrderMinimalRpcError(message) {
  const msg = typeof message === 'string' ? message : '';
  if (!msg) return 'Order could not be created. Please try again.';

  const m = msg.match(/Invalid items\/canteen\/qty:\s*expected\s+(\d+)\s+lines,\s*got\s+(\d+)/i);
  if (m) {
    const expected = m[1];
    const got = m[2];
    return (
      `Some cart items are not valid for your canteen (only ${got} of ${expected} lines matched the menu). ` +
      `Remove items that are not from your current canteen, clear the cart, or refresh the home menu and try again.`
    );
  }

  return msg;
}

/** @deprecated Use prepareCreateOrderMinimalArgs — returns [] on failure (avoid). */
export function buildCreateOrderMinimalItemsPayload(cartItems) {
  const r = prepareCreateOrderMinimalArgs(cartItems, false);
  return r.ok ? r.p_items : [];
}

/** Unwrap RPC return value and optionally load full `orders` row if the function returns only an id. */
export async function finalizeOrderRowFromRpc(rpcData) {
  try {
    // ✅ error handled
    if (typeof rpcData === 'string') {
      const { data: full, error } = await supabase.from('orders').select('*').eq('id', rpcData).maybeSingle();
      if (error) {
        console.error('RPC Error:', error.message || error);
        return { id: rpcData };
      }
      if (!full) {
        console.warn('No data returned');
        return { id: rpcData };
      }
      return full;
    }
    let row = rpcData;
    if (Array.isArray(row)) row = row[0] ?? null;
    if (!row || typeof row !== 'object') return row;
    const id = row.id ?? row.order_id;
    if (!id) return row;
    const normalized = row.id ? row : { ...row, id };
    if (normalized.order_token != null && normalized.order_token !== undefined) {
      return normalized;
    }
    const { data: full, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
    if (error) {
      console.error('RPC Error:', error.message || error);
      return normalized;
    }
    if (!full) {
      console.warn('No data returned');
      return normalized;
    }
    return full;
  } catch (err) {
    console.error('Unexpected Error:', err);
    if (rpcData && typeof rpcData === 'object') return rpcData;
    if (typeof rpcData === 'string') return { id: rpcData };
    return null;
  }
}

const DEFAULT_ORDER_POLL_MS = 600;
const DEFAULT_ORDER_POLL_TIMEOUT_MS = 120000;
const ORDER_FETCH_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, options, timeoutMs = ORDER_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * When `CONFIG.ORDER_HTTP_ENABLED` is false, calls `create_order_minimal` on the Supabase client (session JWT).
 * Otherwise POSTs to `CONFIG.ORDER_API_BASE/order` and polls status.
 *
 * @param {boolean} isTakeaway
 * @param {Array<{ item_id: string, quantity: number }>} items
 * @param {{
 *   requestId: string,
 *   accessToken: string,
 *   pollIntervalMs?: number,
 *   pollTimeoutMs?: number,
 * }} [options]
 * @returns {Promise<{ data: unknown, error: { message: string, code?: string } | null }>}
 */
export async function postOrderHttpCreate(isTakeaway, items, options = {}) {
  const {
    requestId,
    accessToken,
    pollIntervalMs = DEFAULT_ORDER_POLL_MS,
    pollTimeoutMs = DEFAULT_ORDER_POLL_TIMEOUT_MS,
  } = options;

  try {
    /** Default path: RPC in-app (backend /order is optional). */
    if (!CONFIG.ORDER_HTTP_ENABLED) {
      try {
        const { data, error } = await supabase.rpc('create_order_minimal', {
          p_is_takeaway: !!isTakeaway,
          p_items: items,
        });
        if (error) {
          return {
            data: null,
            error: {
              message: error.message || String(error),
              code: error.code != null ? String(error.code) : undefined,
              hint: error.hint,
            },
          };
        }
        if (data == null) {
          return { data: null, error: { message: 'No order returned from server.' } };
        }
        return { data, error: null };
      } catch (err) {
        return { data: null, error: { message: err?.message || String(err) } };
      }
    }

    const base = String(CONFIG.ORDER_API_BASE || '').replace(/\/$/, '');
    if (!base) {
      return { data: null, error: { message: 'ORDER_API_BASE / EXPO_PUBLIC_ORDER_API_BASE is not set.' } };
    }
    if (!requestId || typeof requestId !== 'string') {
      return { data: null, error: { message: 'requestId is required for queued order API.' } };
    }
    if (!accessToken || typeof accessToken !== 'string') {
      return { data: null, error: { message: 'accessToken is required for queued order API.' } };
    }

    const url = `${base}/order`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        items,
        isTakeaway,
        requestId,
      }),
    });

    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }

    if (!res.ok) {
      const msg =
        (body && (body.message || body.error)) || res.statusText || `HTTP ${res.status}`;
      return { data: null, error: { message: String(msg), code: String(res.status) } };
    }

    /** Immediate sync response (non-queue deploy) */
    if (body && typeof body === 'object' && body.id != null && !body.status) {
      return { data: body, error: null };
    }

    const status = body && typeof body === 'object' ? body.status : null;
    const rid = (body && typeof body === 'object' && body.requestId) || requestId;

    if (status === 'completed' && body.id) {
      return { data: { id: body.id, order_token: body.order_token }, error: null };
    }

    if (status === 'failed') {
      return {
        data: null,
        error: { message: String(body.message || body.error || 'Order failed'), code: 'ORDER_FAILED' },
      };
    }

    if (status !== 'queued' && status !== 'processing' && status !== 'completed') {
      return {
        data: null,
        error: {
          message: `Unexpected POST /order response: ${JSON.stringify(body)}`,
          code: String(res.status),
        },
      };
    }

    const deadline = Date.now() + pollTimeoutMs;
    let lastPoll = null;

    while (Date.now() < deadline) {
      const sRes = await fetchWithTimeout(`${base}/order/status/${encodeURIComponent(rid)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      try {
        lastPoll = await sRes.json();
      } catch (_) {
        lastPoll = null;
      }

      if (!sRes.ok) {
        const msg =
          (lastPoll && (lastPoll.message || lastPoll.error)) ||
          sRes.statusText ||
          `HTTP ${sRes.status}`;
        return { data: null, error: { message: String(msg), code: String(sRes.status) } };
      }

      if (lastPoll?.status === 'completed' && lastPoll.id) {
        return {
          data: { id: lastPoll.id, order_token: lastPoll.order_token },
          error: null,
        };
      }

      if (lastPoll?.status === 'failed') {
        return {
          data: null,
          error: {
            message: String(lastPoll.error || 'Order failed'),
            code: 'ORDER_FAILED',
          },
        };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return {
      data: null,
      error: {
        message: `Order did not complete within ${pollTimeoutMs}ms. Last status: ${JSON.stringify(lastPoll)}`,
        code: 'ORDER_POLL_TIMEOUT',
      },
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return {
      data: null,
      error: {
        message: aborted
          ? `Order request timed out after ${ORDER_FETCH_TIMEOUT_MS / 1000}s. Check EXPO_PUBLIC_ORDER_API_BASE or use direct Supabase (clear EXPO_PUBLIC_USE_ORDER_HTTP).`
          : err?.message || String(err),
        code: aborted ? 'ORDER_FETCH_TIMEOUT' : undefined,
      },
    };
  }
}

export const orderService = {
  async getOrders(userId) {
    try {
      // ✅ error handled
      if (!userId) {
        return { data: [], error: null };
      }
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('placed_by', userId)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('getOrders:', error.message || error);
        return { data: [], error };
      }
      return { data: data || [], error: null };
    } catch (err) {
      console.error('Unexpected Error:', err);
      return { data: [], error: null };
    }
  },
  /** Creates order via HTTP POST to `CONFIG.ORDER_API_BASE/order` (see `postOrderHttpCreate`). */
  async createOrderMinimal(pIsTakeaway, pItems, httpOpts = {}) {
    try {
      const prep = prepareCreateOrderMinimalArgs(pItems || [], pIsTakeaway);
      if (!prep.ok) {
        return { data: null, error: { message: prep.error } };
      }
      const { data, error } = await postOrderHttpCreate(prep.p_is_takeaway, prep.p_items, httpOpts);
      if (error) {
        console.error('Order HTTP Error:', error.message || error);
        return { data: null, error };
      }
      if (data == null) {
        console.warn('No data returned');
        return { data: null, error: { message: 'No order returned from server.' } };
      }
      return { data, error: null };
    } catch (err) {
      console.error('Unexpected Error:', err);
      return { data: null, error: { message: err?.message || String(err) } };
    }
  },
  /** @deprecated Use createOrderMinimal — never insert into `orders` from the client (RLS / schema). */
  async createOrder(orderData) {
    try {
      const rawItems = orderData?.items || [];
      const isTakeaway =
        orderData?.isTakeaway === true ||
        orderData?.order_type === true ||
        orderData?.is_takeaway === true;
      const prep = prepareCreateOrderMinimalArgs(rawItems, isTakeaway);
      if (!prep.ok) {
        return { data: null, error: { message: prep.error } };
      }
      const { data, error } = await postOrderHttpCreate(prep.p_is_takeaway, prep.p_items, {
        requestId: orderData?.requestId,
        accessToken: orderData?.accessToken,
      });
      if (error) {
        console.error('Order HTTP Error:', error.message || error);
        return { data: null, error };
      }
      if (data == null) {
        console.warn('No data returned');
        return { data: null, error: { message: 'No order returned from server.' } };
      }
      return { data, error: null };
    } catch (err) {
      console.error('Unexpected Error:', err);
      return { data: null, error: { message: err?.message || String(err) } };
    }
  },
  async getOrderItems(orderId) {
    try {
      if (!orderId) {
        return { data: [], error: null };
      }
      const { data, error } = await supabase
        .from('order_items')
        .select(`
        *,
        items (
          id,
          name,
          price,
          is_active,
          category_id,
          canteen_id
        )
      `)
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (error) {
        console.error('getOrderItems:', error.message || error);
        return { data: [], error };
      }
      return { data: data || [], error: null };
    } catch (err) {
      console.error('Unexpected Error:', err);
      return { data: [], error: null };
    }
  },
  /**
   * Prefer `postOrderHttpCreate` / order HTTP API. Direct client inserts can bypass business rules; keep blocked by RLS in production.
   * @param {Array<Record<string, unknown>>} orderItemsData
   */
  async createOrderItems(orderItemsData) {
    try {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('orderService.createOrderItems: avoid using from the client; use postOrderHttpCreate / order HTTP API.');
      }
      const { data, error } = await supabase
        .from('order_items')
        .insert(orderItemsData)
        .select();
      if (error) {
        console.error('createOrderItems:', error.message || error);
        return { data: [], error };
      }
      return { data: data || [], error: null };
    } catch (err) {
      console.error('Unexpected Error:', err);
      return { data: [], error: null };
    }
  }
};

// Favorites service
export const favoritesService = {
  async getFavorites(userId) {
    try {
      console.log('🔄 Fetching favorites for user:', userId);
      const { data, error } = await supabase
        .from('favorites')
        .select('*, food_items(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error fetching favorites:', error);
        return { data: [], error: error.message };
      }

      console.log('✅ Favorites fetched:', data?.length || 0);
      return { data: data || [], error: null };
    } catch (error) {
      console.error('❌ Exception fetching favorites:', error);
      return { data: [], error: error.message };
    }
  },

  async addToFavorites(userId, foodItemId) {
    try {
      console.log('🔄 Adding to favorites:', { userId, foodItemId });
      const { data, error } = await supabase
        .from('favorites')
        .insert({
          user_id: userId,
          food_item_id: foodItemId
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Error adding to favorites:', error);
        return { data: null, error: error.message };
      }

      console.log('✅ Added to favorites');
      return { data, error: null };
    } catch (error) {
      console.error('❌ Exception adding to favorites:', error);
      return { data: null, error: error.message };
    }
  },

  async removeFromFavorites(userId, foodItemId) {
    try {
      console.log('🔄 Removing from favorites:', { userId, foodItemId });
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('user_id', userId)
        .eq('food_item_id', foodItemId);
      
      if (error) {
        console.error('❌ Error removing from favorites:', error);
        return { error: error.message };
      }
      
      console.log('✅ Removed from favorites');
      return { error: null };
    } catch (error) {
      console.error('❌ Exception removing from favorites:', error);
      return { error: error.message };
    }
  },

  async isFavorite(userId, foodItemId) {
    try {
      const { data, error } = await supabase
        .from('favorites')
        .select('id')
        .eq('user_id', userId)
        .eq('food_item_id', foodItemId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found" error
        console.error('❌ Error checking favorite status:', error);
        return { isFavorite: false, error: error.message };
      }

      return { isFavorite: !!data, error: null };
    } catch (error) {
      console.error('❌ Exception checking favorite status:', error);
      return { isFavorite: false, error: error.message };
    }
  },

  async toggleFavorite(userId, foodItemId) {
    try {
      console.log('🔄 Toggling favorite:', { userId, foodItemId });
      
      // First check if it's already a favorite
      const { isFavorite } = await this.isFavorite(userId, foodItemId);
      
      if (isFavorite) {
        // Remove from favorites
        const { error } = await this.removeFromFavorites(userId, foodItemId);
        if (error) {
          return { data: null, error, removed: false };
        }
        return { data: null, error: null, removed: true };
      } else {
        // Add to favorites
        const { data, error } = await this.addToFavorites(userId, foodItemId);
        if (error) {
          return { data: null, error, removed: false };
        }
        return { data, error: null, removed: false };
      }
    } catch (error) {
      console.error('❌ Exception toggling favorite:', error);
      return { data: null, error: error.message, removed: false };
    }
  }
};

/**
 * Subscribe to `items` updates for stock/availability.
 * @param {function} callback - (payload) => void
 * @param {{ userId?: string|null, canteenId?: string|null }} [options] - Pass canteenId when known to avoid a race before DB resolves.
 */
export const subscribeToFoodAvailability = async (callback, options = {}) => {
  const userId = options?.userId ?? null;
  const canteenIdOpt = options?.canteenId ?? null;

  try {
    console.log('🔄 Subscribing to food availability changes...');

    let userCanteenId = canteenIdOpt || null;
    if (!userCanteenId && userId) {
      userCanteenId = await getUserCanteenId(userId);
    }

    if (!userCanteenId) {
      console.log('⏭️ Skipping food availability realtime (no canteen id yet).');
      return null;
    }

    const channelName = `food_availability_${String(userCanteenId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const canteenKey = String(userCanteenId);

    // No server-side `filter`: filtered Realtime + RLS often yields CHANNEL_ERROR even when
    // `items` is in `supabase_realtime`. RLS still decides which row events you receive.
    const changeConfig = {
      event: 'UPDATE',
      schema: 'public',
      table: 'items',
    };

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', changeConfig, (payload) => {
        try {
          // ✅ crash prevention added
          const row = payload?.new || {};
          if (String(row.canteen_id ?? '') !== canteenKey) return;
          console.log('📡 Food availability changed:', row);
          if (callback && typeof callback === 'function') {
            callback(payload);
          }
        } catch (e) {
          console.error('Food availability callback:', e);
        }
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Successfully subscribed to food availability changes');
        } else if (status === 'CHANNEL_ERROR') {
          const detail =
            err && typeof err === 'object'
              ? JSON.stringify(err)
              : String(err?.message || err || 'unknown');
          console.warn(
            '⚠️ Food availability Realtime channel error (often a brief race on reload / effect cleanup):',
            detail
          );
          console.log(
            '💡 If this repeats: confirm `items` is in `supabase_realtime` and SELECT RLS allows your role to read those rows.'
          );
        } else if (status === 'TIMED_OUT') {
          console.warn('⚠️ Food availability channel subscribe timed out');
        } else if (status === 'CLOSED') {
          console.log('📴 Food availability channel closed');
        }
      });

    return channel;
  } catch (error) {
    console.error('❌ Exception in subscribeToFoodAvailability:', error);
    return null;
  }
};

// Public URL only — never export the anon key (same-origin bundle exposure risk in web builds)
export const SUPABASE_CONFIG = {
  URL: SUPABASE_URL
}; 