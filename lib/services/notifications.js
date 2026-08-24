import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../supabase';
import { areUserNotificationsEnabled } from '../NotificationService';
import { getNotificationsEnabled, setNotificationsEnabled } from '../settingsCache';

/**
 * @typedef {'no_user' | 'simulator' | 'expo_go' | 'permission_denied' | 'no_project_id' | 'token_failed' | 'save_failed' | 'unknown'} PushRegisterReason
 */

async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
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
 * Persist FCM / device push token on `user_tokens` (unique by `fcm_token`).
 * Uses SECURITY DEFINER RPC so a token linked to another user_id can be
 * deleted and re-inserted for the current user (RLS blocks direct cross-user writes).
 * Multiple devices for one user_id → multiple rows (each token unique).
 * @returns {Promise<{ ok: boolean, reason?: PushRegisterReason }>}
 */
async function savePushTokenToSupabase(userId, tokenValue) {
  const platform = resolvePlatform();

  try {
    const { data, error } = await supabase.rpc('claim_user_push_token', {
      p_fcm_token: tokenValue,
      p_platform: platform,
    });

    if (error) {
      console.log('Failed claiming push token via RPC:', error);
      return { ok: false, reason: 'save_failed' };
    }

    const payload = data && typeof data === 'object' ? data : {};
    if (payload.success === false) {
      console.log('claim_user_push_token rejected:', payload.error);
      return { ok: false, reason: 'save_failed' };
    }

    // Defense-in-depth: ensure caller session matches the userId we intended.
    if (userId && payload.token_id) {
      const { data: row } = await supabase
        .from('user_tokens')
        .select('user_id')
        .eq('id', payload.token_id)
        .maybeSingle();
      if (row?.user_id && String(row.user_id) !== String(userId)) {
        console.log('claim_user_push_token user mismatch after claim');
        return { ok: false, reason: 'save_failed' };
      }
    }

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
 * Disable only this device's token for the signed-out user (other devices keep working).
 * Also turns off the local notifications preference on this device.
 */
export async function disablePushOnSignOut(userId) {
  try {
    await setNotificationsEnabled(false);

    if (!userId || Constants.appOwnership === 'expo' || !Device.isDevice) {
      return { ok: true };
    }

    const tokenValue = await getCurrentDevicePushToken();
    const now = new Date().toISOString();

    if (tokenValue) {
      const { error } = await supabase
        .from('user_tokens')
        .update({ is_enabled: false, updated_at: now })
        .eq('fcm_token', tokenValue)
        .eq('user_id', userId);
      if (error) {
        console.log('disablePushOnSignOut token update:', error);
        return { ok: false };
      }
      return { ok: true };
    }

    return { ok: true };
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
 * Update user_tokens is_enabled status in Supabase based on permission check.
 */
export async function updatePushTokenStatusInSupabase(userId, isEnabled) {
  if (!userId) return { ok: false };
  try {
    let tokenValue = null;
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      tokenValue = deviceToken?.data ? String(deviceToken.data) : null;
    } catch (err) {
      console.log('updatePushTokenStatusInSupabase getDevicePushTokenAsync:', err?.message || err);
    }

    if (isEnabled && !tokenValue) {
      return await registerForPushNotificationsAsync(userId);
    }

    if (tokenValue) {
      if (isEnabled) {
        return await savePushTokenToSupabase(userId, tokenValue);
      }
      const platform = resolvePlatform();
      const { error } = await supabase.from('user_tokens').upsert(
        {
          user_id: userId,
          fcm_token: tokenValue,
          platform,
          is_enabled: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'fcm_token' }
      );
      if (error) {
        console.log('Failed updating user_tokens status with token:', error);
        return { ok: false };
      }
    } else {
      const { error } = await supabase
        .from('user_tokens')
        .update({ is_enabled: !!isEnabled, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (error) {
        console.log('Failed updating user_tokens status:', error);
        return { ok: false };
      }
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
    if (newToken) {
      console.log('🔄 Native push token refreshed by OS, updating user_tokens...');
      await savePushTokenToSupabase(userId, newToken);
    }
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
