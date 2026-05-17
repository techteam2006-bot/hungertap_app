import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'local_cart_v1_';

export function getCartStorageKey(userId) {
  return `${PREFIX}${userId}`;
}

export async function loadLocalCart(userId) {
  if (!userId) return [];
  const raw = await AsyncStorage.getItem(getCartStorageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLocalCart(userId, cartItems) {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(getCartStorageKey(userId), JSON.stringify(cartItems));
  } catch (e) {
    console.log('saveLocalCart error', e?.message || e);
  }
}

export async function clearLocalCartStorage(userId) {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(getCartStorageKey(userId));
  } catch (e) {
    console.log('clearLocalCartStorage error', e?.message || e);
  }
}
