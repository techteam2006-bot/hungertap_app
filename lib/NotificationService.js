import * as Notifications from 'expo-notifications';
import { Platform, Linking, Alert } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { getOrderStatusNotificationBody } from './orderStatus';
import { getNotificationsEnabled } from './settingsCache';

export const NOTIFICATIONS_ENABLED_KEY = 'notificationsEnabled';

const isExpoGo = Constants.appOwnership === 'expo';

function resolveAndroidChannelId(data) {
  const t = data?.type;
  if (t === 'cart_warning' || t === 'cart_cleared') return 'cart-timeout';
  return 'orders';
}

/** Profile toggle preference — default ON when unset (matches FCM auto-register on fresh installs). */
export async function areUserNotificationsEnabled() {
  try {
    return await getNotificationsEnabled();
  } catch {
    return true;
  }
}

// Avoid Expo Go SDK 53+ console.error from push token auto-registration paths.
if (!isExpoGo) {
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

class NotificationService {
  constructor() {
    this.isInitialized = false;
  }

  /**
   * Local notifications (scheduleNotificationAsync) work on iOS/Android, including Expo Go for alerts.
   * Push token registration is separate (see lib/services/notifications.js).
   */
  isNotificationsAvailable() {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  }

  async initialize() {
    if (this.isInitialized) return true;

    try {
      // Do not prompt for permission until the user enables notifications in Profile.
      const enabled = await areUserNotificationsEnabled();
      if (!enabled) {
        return false;
      }

      const { status } = await Notifications.requestPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert(
          'Notifications Disabled',
          'Enable notifications in settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return false;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'General',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: 'default',
        });

        await Notifications.setNotificationChannelAsync('orders', {
          name: 'Order Notifications',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: 'default',
        });

        await Notifications.setNotificationChannelAsync('cart-timeout', {
          name: 'Cart Notifications',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: 'default',
        });
      }

      this.isInitialized = true;
      return true;

    } catch (error) {
      console.error('Init error:', error);
      return false;
    }
  }

  // ✅ FETCH ORDER TOKEN FROM DB
  async getOrderToken(orderId) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('order_token')
        .eq('id', orderId)
        .single();

      if (error) {
        console.error('Token fetch error:', error);
        return null;
      }

      return data?.order_token || null;

    } catch (err) {
      console.error('Token fetch crash:', err);
      return null;
    }
  }

  // ✅ GENERIC SEND
  async sendNotification(content) {
    try {
      if (!(await areUserNotificationsEnabled())) {
        return false;
      }

      const ready = await this.initialize();
      if (!ready) return false;

      await Notifications.scheduleNotificationAsync({
        content: {
          ...content,
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          ...(Platform.OS === 'android' && content?.data != null
            ? { channelId: resolveAndroidChannelId(content.data) }
            : {}),
        },
        trigger: null,
      });

      return true;

    } catch (error) {
      console.error('Send error:', error);
      return false;
    }
  }

  // ✅ ORDER PLACED (USES TOKEN)
  async sendOrderNotification(orderId, totalAmount, orderItems = []) {
    const token = await this.getOrderToken(orderId);

    const itemNames = orderItems
      ?.map(item => `${item.name} (x${item.quantity})`)
      .join(', ')
      .slice(0, 100);

    const displayId = token || 'Your Order';

    return this.sendNotification({
      title: '🎉 Order Placed!',
      body: itemNames
        ? `${displayId}: ${itemNames} - ₹${totalAmount}`
        : `${displayId} confirmed - ₹${totalAmount}`,
      data: { type: 'order_placed', orderId },
    });
  }

  // ✅ ORDER STATUS (USES TOKEN)
  async sendOrderStatusNotification(orderId, status) {
    const token = await this.getOrderToken(orderId);

    const title = token ? `📦 Order #${token}` : '📦 Your order';

    return this.sendNotification({
      title,
      body: getOrderStatusNotificationBody(status),
      data: { type: 'order_status', orderId, order_token: token, status },
    });
  }

  // ✅ CART WARNING
  async sendCartWarningNotification(userId) {
    return this.sendNotification({
      title: '🛒 Cart Warning',
      body: 'Your cart will expire soon!',
      data: { type: 'cart_warning', userId },
    });
  }

  // ✅ CART CLEARED
  async sendCartClearedNotification(userId) {
    return this.sendNotification({
      title: '🛒 Cart Cleared',
      body: 'Your cart was cleared after inactivity.',
      data: { type: 'cart_cleared', userId },
    });
  }

  // ✅ TEST
  async sendTestNotification() {
    return this.sendNotification({
      title: '🔔 Test Notification',
      body: 'Notifications are working!',
      data: { type: 'test' },
    });
  }

  addNotificationReceivedListener(callback) {
    return Notifications.addNotificationReceivedListener(callback);
  }

  addNotificationResponseReceivedListener(callback) {
    return Notifications.addNotificationResponseReceivedListener(callback);
  }

  async clearAllNotifications() {
    try {
      await Notifications.dismissAllNotificationsAsync();
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (e) {
      console.warn('clearAllNotifications:', e?.message || e);
    }
  }
}

export default new NotificationService();
