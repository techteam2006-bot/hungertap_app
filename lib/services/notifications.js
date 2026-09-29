import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../supabase';
import NotificationService, { areUserNotificationsEnabled } from '../NotificationService';
import { getNotificationsEnabled, setNotificationsEnabled } from '../settingsCache';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** The fcm_token this phone last saved to user_tokens (to find/replace its own row). */
const SAVED_PUSH_TOKEN_KEY = 'ht_saved_push_token';
async function getSavedPushToken() {
  try {
    return (await AsyncStorage.getItem(SAVED_PUSH_TOKEN_KEY)) || null;
  } catch (_) {
    return null;
  }
}
async function setSavedPushToken(token) {
  try {
    if (token) await AsyncStorage.setItem(SAVED_PUSH_TOKEN_KEY, String(token));
  } catch (_) {}
}

/**
 * @typedef {'no_user' | 'simulator' | 'expo_go' | 'permission_denied' | 'no_project_id' | 'token_failed' | 'save_failed' | 'unknown'} PushRegisterReason
 */

async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  // Expo Go: remote notification channel APIs can throw after SDK 53 — skip safely.
  if (Constants.appOwnership === 'expo') return;
  const common = {
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
    sound: 'default',
  };
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      ...common,
    });
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'Order Notifications',
      ...common,
    });
    await Notifications.setNotificationChannelAsync('cart-timeout', {
      name: 'Cart Notifications',
      ...common,
    });
  } catch (chErr) {
    console.log('Notification channel setup:', chErr?.message || chErr);
  }
}

function resolvePlatform() {
  return Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
    ? Platform.OS
    : null;
}

/**
 * Native FCM/APNs device token when available (null in Expo Go / sim).
 * @returns {Promise<string|null>}
 */
export async function getCurrentDevicePushToken() {
  if (Constants.appOwnership === 'expo' || !Device.isDevice) return null;
  try {
    const deviceToken = await Notifications.getDevicePushTokenAsync();
    return deviceToken?.data ? String(deviceToken.data) : null;
  } catch (err) {
    console.log('getCurrentDevicePushToken:', err?.message || err);
    return null;
  }
}

/**
 * Save this phone's FCM token → ONE row in `user_tokens` (unique by fcm_token), is_enabled = true.
 *  1. claim_user_push_token RPC (moves a token still linked to another account on a shared phone).
 *  2. Update this user's row for the token → enabled. If there is no row, insert one.
 *  3. If this phone previously saved a different token (Android rotated it), delete that
 *     old row so the phone never ends up with two rows.
 * @returns {Promise<{ ok: boolean, reason?: PushRegisterReason }>}
 */
async function savePushTokenToSupabase(userId, tokenValue) {
  if (!userId || !tokenValue) return { ok: false, reason: 'save_failed' };
  const platform = resolvePlatform();
  const now = new Date().toISOString();

  try {
    const { error: rpcError } = await supabase.rpc('claim_user_push_token', {
      p_fcm_token: tokenValue,
      p_platform: platform,
    });
    if (rpcError) console.log('claim_user_push_token failed, saving directly:', rpcError?.message || rpcError);
  } catch (e) {
    console.log('claim_user_push_token error, saving directly:', e?.message || e);
  }

  try {
    const { data: updated, error: updateErr } = await supabase
      .from('user_tokens')
      .update({ is_enabled: true, platform, updated_at: now })
      .eq('fcm_token', tokenValue)
      .eq('user_id', userId)
      .select('id');

    let saved = !updateErr && Array.isArray(updated) && updated.length > 0;
    if (!saved) {
      const { error: insertErr } = await supabase.from('user_tokens').insert({
        user_id: userId,
        fcm_token: tokenValue,
        platform,
        is_enabled: true,
      });
      if (insertErr) {
        console.log('Saving push token failed:', updateErr || insertErr);
        return { ok: false, reason: 'save_failed' };
      }
      saved = true;
    }

    // Replace this phone's previous token row (token rotated / changed).
    const previous = await getSavedPushToken();
    if (previous && previous !== tokenValue) {
      await supabase
        .from('user_tokens')
        .delete()
        .eq('fcm_token', previous)
        .eq('user_id', userId)
        .then(() => {}, () => {});
    }
    await setSavedPushToken(tokenValue);
    return { ok: true };
  } catch (e) {
    console.log('savePushTokenToSupabase error', e);
    return { ok: false, reason: 'save_failed' };
  }
}

/**
 * True when this device has an enabled token row for the given user.
 */
export async function hasEnabledPushTokenForUser(userId) {
  if (!userId) return false;
  try {
    const tokenValue = await getCurrentDevicePushToken();
    if (!tokenValue) {
      const { data, error } = await supabase
        .from('user_tokens')
        .select('id')
        .eq('user_id', userId)
        .eq('is_enabled', true)
        .limit(1);
      if (error) return false;
      return Array.isArray(data) && data.length > 0;
    }

    const { data, error } = await supabase
      .from('user_tokens')
      .select('id, user_id, is_enabled')
      .eq('fcm_token', tokenValue)
      .maybeSingle();

    if (error || !data) return false;
    return String(data.user_id) === String(userId) && data.is_enabled === true;
  } catch (_) {
    return false;
  }
}

/**
 * Checkout gate: local pref + OS permission + token owned by this user.
 * @returns {Promise<{ ready: boolean, reason?: string, canRegister?: boolean }>}
 */
export async function getPushReadinessForOrdering(userId) {
  if (!userId) return { ready: false, reason: 'no_user', canRegister: false };

  if (Constants.appOwnership === 'expo') {
    // Remote push unavailable in Expo Go — do not block checkout.
    return { ready: true, reason: 'expo_go', canRegister: false };
  }
  if (!Device.isDevice) {
    return { ready: true, reason: 'simulator', canRegister: false };
  }

  const localOn = await getNotificationsEnabled();
  if (!localOn) {
    return { ready: false, reason: 'local_disabled', canRegister: true };
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    return { ready: false, reason: 'permission_denied', canRegister: true };
  }

  const hasToken = await hasEnabledPushTokenForUser(userId);
  if (!hasToken) {
    return { ready: false, reason: 'token_missing', canRegister: true };
  }

  return { ready: true };
}

/**
 * Logout: switch notifications OFF exactly like the Profile toggle "off":
 *  - local notifications preference → off (toggle shows OFF after sign-in),
 *  - this phone's fcm_token row → is_enabled = false (other phones keep working),
 *  - clears notifications already shown on this phone.
 * Runs before supabase.auth.signOut() so RLS still allows the update.
 */
export async function disablePushOnSignOut(userId) {
  try {
    await setNotificationsEnabled(false);
    NotificationService.clearAllNotifications().catch(() => {});
    NotificationService.isInitialized = false;

    if (!userId || Constants.appOwnership === 'expo' || !Device.isDevice) {
      return { ok: true };
    }

    // Same fcm_token-based update the Profile toggle uses when turned off.
    const res = await updatePushTokenStatusInSupabase(userId, false);
    return { ok: !!res?.ok };
  } catch (e) {
    console.log('disablePushOnSignOut error:', e);
    return { ok: false };
  }
}

/**
 * Register for push (strict native FCM for Android & iOS) and save to Supabase.
 * @returns {Promise<{ token: string | null, reason?: PushRegisterReason, localOnly?: boolean }>}
 */
export async function registerForPushNotificationsAsync(userId) {
  try {
    if (!userId) {
      console.log('registerForPushNotificationsAsync: missing userId');
      return { token: null, reason: 'no_user' };
    }

    // Expo Go (SDK 53+) cannot register remote push — allow caller to enable local-only prefs.
    if (Constants.appOwnership === 'expo') {
      console.log('Expo Go: remote push unavailable; local notifications only');
      return { token: null, reason: 'expo_go', localOnly: true };
    }

    if (!Device.isDevice) {
      console.log('Physical device required for push');
      return { token: null, reason: 'simulator' };
    }

    await ensureAndroidChannels();

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') {
      console.log('Notification permission not granted:', status);
      return { token: null, reason: 'permission_denied' };
    }

    // 1) Native device token first (uses google-services.json on Android / APNs on iOS)
    let tokenValue = null;
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      tokenValue = deviceToken?.data ? String(deviceToken.data) : null;
      if (tokenValue) {
        console.log('Got native FCM device push token');
      }
    } catch (nativeErr) {
      console.log('getDevicePushTokenAsync error:', nativeErr?.message || nativeErr);
    }

    // 2) Fallback: Expo push token (needs EAS projectId)
    if (!tokenValue) {
      const projectId =
        Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
      if (projectId) {
        try {
          const token = await Notifications.getExpoPushTokenAsync({ projectId });
          tokenValue = token?.data || null;
          if (tokenValue) {
            console.log('Got fallback Expo push token');
          }
        } catch (tokErr) {
          console.log('getExpoPushTokenAsync error:', tokErr?.message || tokErr);
        }
      } else {
        console.log('Missing EAS projectId and no native FCM token');
      }
    }

    if (!tokenValue) {
      console.log('Failed to generate device or Expo push token');
      return { token: null, reason: 'token_failed' };
    }

    const saved = await savePushTokenToSupabase(userId, tokenValue);
    if (!saved.ok) {
      return { token: null, reason: saved.reason || 'save_failed' };
    }

    return { token: tokenValue };
  } catch (e) {
    console.log('registerForPushNotificationsAsync error', e);
    return { token: null, reason: 'unknown' };
  }
}

/**
 * Turn this phone's `user_tokens` row on/off.
 *  ON  → save the token (update or insert one row, is_enabled = true).
 *  OFF → only UPDATE this phone's row (matched by fcm_token) to is_enabled = false.
 *        Never inserts a new row.
 */
export async function updatePushTokenStatusInSupabase(userId, isEnabled) {
  if (!userId) return { ok: false };
  try {
    if (isEnabled) {
      const res = await registerForPushNotificationsAsync(userId);
      return { ok: !!res?.token, ...res };
    }

    let liveToken = null;
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      liveToken = deviceToken?.data ? String(deviceToken.data) : null;
    } catch (err) {
      console.log('updatePushTokenStatusInSupabase getDevicePushTokenAsync:', err?.message || err);
    }
    const savedToken = await getSavedPushToken();
    const tokens = [...new Set([liveToken, savedToken].filter(Boolean))];
    const now = new Date().toISOString();

    let query = supabase
      .from('user_tokens')
      .update({ is_enabled: false, updated_at: now })
      .eq('user_id', userId);
    // No token known on this phone at all → fall back to the user's rows.
    if (tokens.length > 0) query = query.in('fcm_token', tokens);
    const { error } = await query;
    if (error) {
      console.log('Failed turning off user_tokens:', error);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.log('updatePushTokenStatusInSupabase error:', e);
    return { ok: false };
  }
}

/**
 * Subscribe to token rotation events from the OS and sync to Supabase.
 */
export function setupPushTokenRefreshListener(userId) {
  if (!userId || Constants.appOwnership === 'expo') return () => {};
  const subscription = Notifications.addPushTokenListener(async (tokenObj) => {
    const newToken = tokenObj?.data ? String(tokenObj.data) : null;
    if (!newToken) return;
    // Toggle is OFF → don't switch the row back on.
    if (!(await getNotificationsEnabled().catch(() => true))) return;
    console.log('🔄 Native push token refreshed by OS, updating user_tokens...');
    await savePushTokenToSupabase(userId, newToken);
  });
  return () => {
    if (subscription && subscription.remove) {
      subscription.remove();
    }
  };
}


export function setupForegroundHandler() {
  // Expo Go SDK 53+: remote push APIs error via console.error — skip handler setup.
  if (Constants.appOwnership === 'expo') return;

  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const enabled = await areUserNotificationsEnabled();
      return {
        shouldShowBanner: enabled,
        shouldShowList: enabled,
        shouldPlaySound: enabled,
        shouldSetBadge: false,
      };
    },
  });
}

/** Dev-only — do not expose arbitrary push targets in production client builds. */
export async function sendTestNotificationViaEdge(userId) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  try {
    if (!userId) {
      console.log('sendTestNotificationViaEdge: no userId');
      return;
    }
    const { data, error } = await supabase.functions.invoke('send-notification', {
      body: { userId, title: 'Test Notification', body: 'This is a test from backend' },
    });
    if (error) {
      console.error('sendTestNotificationViaEdge:', error.message || error);
      return;
    }
    if (data == null) {
      console.warn('No data returned');
    }
  } catch (e) {
    console.error('Unexpected Error:', e);
  }
}
