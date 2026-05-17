import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../supabase';

/**
 * @typedef {'no_user' | 'simulator' | 'permission_denied' | 'no_project_id' | 'token_failed' | 'save_failed' | 'unknown'} PushRegisterReason
 */

/**
 * Register for Expo push and save token to Supabase.
 * @returns {Promise<{ token: string | null, reason?: PushRegisterReason }>}
 */
export async function registerForPushNotificationsAsync(userId) {
  try {
    if (!userId) {
      console.log('registerForPushNotificationsAsync: missing userId');
      return { token: null, reason: 'no_user' };
    }

    if (!Device.isDevice) {
      console.log('Physical device required for push');
      return { token: null, reason: 'simulator' };
    }

    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });
      } catch (chErr) {
        console.log('Notification channel setup:', chErr?.message || chErr);
      }
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') {
      console.log('Notification permission not granted:', status);
      return { token: null, reason: 'permission_denied' };
    }

    const projectId =
      Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.log('Missing EAS projectId for push token');
      return { token: null, reason: 'no_project_id' };
    }

    let tokenValue;
    try {
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      tokenValue = token?.data;
    } catch (tokErr) {
      console.log('getExpoPushTokenAsync error', tokErr);
      return { token: null, reason: 'token_failed' };
    }

    if (!tokenValue) {
      return { token: null, reason: 'token_failed' };
    }

    // Expo push token (`ExponentPushToken[...]`) — stored in `fcm_token` for the backend notifier pipeline.
    const row = {
      user_id: userId,
      fcm_token: tokenValue,
      is_enabled: true,
    };

    const { error } = await supabase.from('user_tokens').upsert(row);

    if (error) {
      console.log('Failed saving Expo push token to user_tokens.fcm_token', error);
      return { token: null, reason: 'save_failed' };
    }

    return { token: tokenValue };
  } catch (e) {
    console.log('registerForPushNotificationsAsync error', e);
    return { token: null, reason: 'unknown' };
  }
}

export function setupForegroundHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
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
