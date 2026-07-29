import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'local_favorites_v1_';

export function getFavoritesStorageKey(userId) {
  return `${PREFIX}${userId}`;
}

function favoriteId(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = entry.food_item_id ?? entry.id;
  return id != null ? String(id) : null;
}

export function normalizeFavoriteEntry(item, foodItemId) {
  const id = foodItemId != null ? String(foodItemId) : favoriteId(item);
  if (!id) return null;

  if (item && typeof item === 'object') {
    return {
      id,
      food_item_id: id,
      name: item.name ?? 'Unknown Item',
      description: item.description ?? '',
      price: Number(item.price) || 0,
      image_url: item.image_url ?? item.image ?? null,
      category: item.category ?? 'Other',
    };
  }

  return {
    id,
    food_item_id: id,
    name: 'Unknown Item',
    description: '',
    price: 0,
    image_url: null,
    category: 'Other',
  };
}

export async function loadLocalFavorites(userId) {
  if (!userId) return [];
  const raw = await AsyncStorage.getItem(getFavoritesStorageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLocalFavorites(userId, favorites) {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(getFavoritesStorageKey(userId), JSON.stringify(favorites));
  } catch (e) {
    console.log('saveLocalFavorites error', e?.message || e);
  }
}

export async function isLocalFavorite(userId, foodItemId) {
  if (!userId || foodItemId == null) return false;
  const id = String(foodItemId);
  const list = await loadLocalFavorites(userId);
  return list.some((entry) => favoriteId(entry) === id);
}

export async function addLocalFavorite(userId, item, foodItemId) {
  const entry = normalizeFavoriteEntry(item, foodItemId ?? item?.id ?? item?.food_item_id);
  if (!userId || !entry) return null;

  const list = await loadLocalFavorites(userId);
  const id = favoriteId(entry);
  if (list.some((row) => favoriteId(row) === id)) {
    return entry;
  }

  const next = [entry, ...list];
  await saveLocalFavorites(userId, next);
  return entry;
}

export async function removeLocalFavorite(userId, foodItemId) {
  if (!userId || foodItemId == null) return;
  const id = String(foodItemId);
  const list = await loadLocalFavorites(userId);
  const next = list.filter((entry) => favoriteId(entry) !== id);
  await saveLocalFavorites(userId, next);
}
