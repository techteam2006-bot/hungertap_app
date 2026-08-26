/**
 * Phone for payment gateways — stored in auth `user_metadata` only (no DB schema change).
 * Edge `create-order-v2` already reads: phone | phone_number | mobile.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const LOCAL_PHONE_KEY_PREFIX = 'hungertap_user_phone_v1:';

/** Digits only, last 10 for Indian mobiles. */
export function normalizePhoneDigits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function isValidCheckoutPhone(raw) {
  const d = normalizePhoneDigits(raw);
  // India: 10 digits starting 6–9
  return /^[6-9]\d{9}$/.test(d);
}

export function formatPhoneDisplay(raw) {
  const d = normalizePhoneDigits(raw);
  if (d.length !== 10) return d || '';
  return `${d.slice(0, 5)} ${d.slice(5)}`;
}

/**
 * Resolve phone from auth user (+ optional AsyncStorage mirror).
 */
export function getPhoneFromUser(user) {
  if (!user) return '';
  const meta = user.user_metadata || {};
  const fromMeta =
    meta.phone ||
    meta.phone_number ||
    meta.mobile ||
    meta.mobile_number ||
    '';
  const fromAuthPhone = user.phone || '';
  return normalizePhoneDigits(fromMeta || fromAuthPhone);
}

export async function getCachedPhoneForUser(userId) {
  if (!userId) return '';
  try {
    const raw = await AsyncStorage.getItem(LOCAL_PHONE_KEY_PREFIX + String(userId));
    return normalizePhoneDigits(raw);
  } catch {
    return '';
  }
}

async function setCachedPhoneForUser(userId, phone10) {
  if (!userId) return;
  try {
    const d = normalizePhoneDigits(phone10);
    if (!d) {
      await AsyncStorage.removeItem(LOCAL_PHONE_KEY_PREFIX + String(userId));
      return;
    }
    await AsyncStorage.setItem(LOCAL_PHONE_KEY_PREFIX + String(userId), d);
  } catch {
    /* ignore */
  }
}

/**
 * Best available phone: metadata first, then local cache.
 */
export async function resolveUserCheckoutPhone(user) {
  const fromUser = getPhoneFromUser(user);
  if (isValidCheckoutPhone(fromUser)) return fromUser;
  const cached = await getCachedPhoneForUser(user?.id);
  if (isValidCheckoutPhone(cached)) return cached;
  return fromUser || cached || '';
}

/**
 * Persist phone on auth.users.raw_user_meta_data (phone + phone_number + mobile).
 * @returns {Promise<{ ok: boolean, user?: object, phone?: string, error?: string }>}
 */
export async function saveUserPhoneMetadata(phoneRaw) {
  const phone = normalizePhoneDigits(phoneRaw);
  if (!isValidCheckoutPhone(phone)) {
    return {
      ok: false,
      error: 'Enter a valid 10-digit mobile number (starts with 6–9).',
    };
  }

  const { data, error } = await supabase.auth.updateUser({
    data: {
      phone,
      phone_number: phone,
      mobile: phone,
    },
  });

  if (error) {
    return { ok: false, error: error.message || 'Could not save phone number.' };
  }

  const user = data?.user || null;
  if (user?.id) {
    await setCachedPhoneForUser(user.id, phone);
  }

  return { ok: true, user, phone };
}
