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
 * Persist FCM / device push token on `user_tokens` (unique by `fcm_token`).
 * One user may have many rows (phone + tablet). `platform` is ios | android | web.
 * @returns {Promise<{ ok: boolean, reason?: PushRegisterReason }>}
 */
async function savePushTokenToSupabase(userId, tokenValue) {
  const platform =
    Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
      ? Platform.OS
      : null;

  // Clean up old/stale FCM tokens for the same user and platform (prevents duplicates on reinstall / clear data)
  if (userId && platform && tokenValue) {
    try {
      await supabase
        .from('user_tokens')
        .delete()
        .eq('user_id', userId)
        .eq('platform', platform)
        .neq('fcm_token', tokenValue);
    } catch (cleanupErr) {
      console.log('Cleanup old push tokens warning:', cleanupErr?.message || cleanupErr);
    }
  }

  const { error: saveError } = await supabase.from('user_tokens').upsert(
    {
      user_id: userId,
      fcm_token: tokenValue,
      platform,
      is_enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'fcm_token' }
  );

  if (saveError) {
    console.log('Failed saving push token to user_tokens.fcm_token', saveError);
    return { ok: false, reason: 'save_failed' };
  }

  return { ok: true };
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
      const platform =
        Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
          ? Platform.OS
          : null;

      if (platform) {
        try {
          await supabase
            .from('user_tokens')
            .delete()
            .eq('user_id', userId)
            .eq('platform', platform)
            .neq('fcm_token', tokenValue);
        } catch (cErr) {}
      }

      const { error } = await supabase.from('user_tokens').upsert(
        {
          user_id: userId,
          fcm_token: tokenValue,
          platform,
          is_enabled: !!isEnabled,
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
 * Clean up user push tokens from Supabase when signing out.
 */
export async function deletePushTokenForUser(userId) {
  if (!userId) return;
  try {
    let tokenValue = null;
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      tokenValue = deviceToken?.data ? String(deviceToken.data) : null;
    } catch (e) {}

    if (tokenValue) {
      await supabase.from('user_tokens').delete().eq('fcm_token', tokenValue);
    } else {
      await supabase.from('user_tokens').delete().eq('user_id', userId);
    }
  } catch (err) {
    console.log('deletePushTokenForUser error:', err?.message || err);
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
