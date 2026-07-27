import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../supabase';
import { areUserNotificationsEnabled } from '../NotificationService';

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

/**
 * Persist push token on `user_tokens` (no `id` column — key by `user_id`).
 * @returns {Promise<{ ok: boolean, reason?: PushRegisterReason }>}
 */
async function savePushTokenToSupabase(userId, tokenValue) {
  const { data: existing, error: selectErr } = await supabase
    .from('user_tokens')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (selectErr) {
    console.log('Failed checking existing push token', selectErr);
    return { ok: false, reason: 'save_failed' };
  }

  let saveError;
  if (existing) {
    const { error } = await supabase
      .from('user_tokens')
      .update({ fcm_token: tokenValue, is_enabled: true })
      .eq('user_id', userId);
    saveError = error;
  } else {
    const { error } = await supabase
      .from('user_tokens')
      .insert({ user_id: userId, fcm_token: tokenValue, is_enabled: true });
    saveError = error;
  }

  if (saveError) {
    console.log('Failed saving push token to user_tokens.fcm_token', saveError);
    return { ok: false, reason: 'save_failed' };
  }

  return { ok: true };
}

/**
 * Register for push (native FCM preferred, Expo token fallback) and save to Supabase.
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

    // 1) Native device token first (uses google-services.json; no EAS projectId required)
    let tokenValue = null;
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      tokenValue = deviceToken?.data ? String(deviceToken.data) : null;
      if (tokenValue) {
        console.log('Got native device push token');
      }
    } catch (nativeErr) {
      console.log('getDevicePushTokenAsync:', nativeErr?.message || nativeErr);
    }

    // 2) Fallback: Expo push token (needs EAS projectId)
    if (!tokenValue) {
      const projectId =
        Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) {
        console.log('Missing EAS projectId and no native FCM token');
        return { token: null, reason: 'no_project_id' };
      }
      try {
        const token = await Notifications.getExpoPushTokenAsync({ projectId });
        tokenValue = token?.data || null;
      } catch (tokErr) {
        console.log('getExpoPushTokenAsync error', tokErr);
        return { token: null, reason: 'token_failed' };
      }
    }

    if (!tokenValue) {
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

export function setupForegroundHandler() {
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
