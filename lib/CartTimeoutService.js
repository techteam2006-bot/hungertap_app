import { supabase } from './supabase';
import NotificationService from './NotificationService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

class CartTimeoutService {
  constructor() {
    this.timeoutIntervals = new Map(); // Store timeout intervals per user
    this.cleanupIntervals = new Map(); // Store cleanup intervals per user
    this.isInitialized = false;
  }

  // Initialize the service
  async initialize() {
    if (this.isInitialized) return true;
    
    try {
      console.log('🔄 Initializing CartTimeoutService...');
      // Set up notification channels for cart timeout
      await this.setupNotificationChannels();
      this.isInitialized = true;
      console.log('✅ CartTimeoutService initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize CartTimeoutService:', error);
      // Still mark as initialized to prevent repeated attempts
      this.isInitialized = true;
      return false;
    }
  }

  // Set up notification channels
  async setupNotificationChannels() {
    try {
      // Check if setNotificationChannelAsync is available (Android only)
      if (Notifications.setNotificationChannelAsync) {
        // Create cart timeout notification channel
        await Notifications.setNotificationChannelAsync('cart-timeout', {
          name: 'Cart Timeout',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF6B6B',
          sound: 'default',
        });
        console.log('✅ Cart timeout notification channel created');
      } else {
        console.log('📱 setNotificationChannelAsync not available (iOS or Expo Go)');
      }
    } catch (error) {
      console.log('⚠️ Could not setup notification channels:', error.message);
      // Don't throw error, just log it - notifications will still work without channels
    }
  }

  // Start monitoring cart for a user
  async startCartMonitoring(userId) {
    if (!userId) return;

    try {
      // Clear any existing monitoring for this user
      this.stopCartMonitoring(userId);

      // Get user's cart items
      const { data: cartItems, error } = await supabase
        .from('cart_items')
        .select('*')
        .eq('user_id', userId);

      if (error) {
        if (error.code === 'PGRST205') {
          return;
        }
        console.error('Error fetching cart items for monitoring:', error);
        return;
      }

      // If cart is empty, no need to monitor
      if (!cartItems || cartItems.length === 0) {
        return;
      }

      // Get the oldest cart item timestamp
      const oldestCartItem = cartItems.reduce((oldest, item) => {
        return new Date(item.created_at) < new Date(oldest.created_at) ? item : oldest;
      });

      const cartStartTime = new Date(oldestCartItem.created_at);
      const now = new Date();
      const timeSinceCartStart = now - cartStartTime;

      // Calculate remaining time for 45-minute warning
      const warningTime = 45 * 60 * 1000; // 45 minutes in milliseconds
      const cleanupTime = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      const timeUntilWarning = Math.max(0, warningTime - timeSinceCartStart);
      const timeUntilCleanup = Math.max(0, cleanupTime - timeSinceCartStart);

      // Set up warning notification (45 minutes)
      if (timeUntilWarning > 0) {
        const warningTimeout = setTimeout(async () => {
          await this.sendCartWarningNotification(userId);
        }, timeUntilWarning);

        this.timeoutIntervals.set(`${userId}_warning`, warningTimeout);
      } else {
        // Cart is already older than 45 minutes, send warning immediately
        await this.sendCartWarningNotification(userId);
      }

      // Set up cleanup (24 hours)
      if (timeUntilCleanup > 0) {
        const cleanupTimeout = setTimeout(async () => {
          await this.clearExpiredCart(userId);
        }, timeUntilCleanup);

        this.cleanupIntervals.set(`${userId}_cleanup`, cleanupTimeout);
      } else {
        // Cart is already older than 24 hours, clear immediately
        await this.clearExpiredCart(userId);
      }

      // Store cart monitoring info
      await this.storeCartMonitoringInfo(userId, cartStartTime);

    } catch (error) {
      console.error('Error starting cart monitoring:', error);
    }
  }

  // Stop monitoring cart for a user
  stopCartMonitoring(userId) {
    if (!userId) return;

    // Clear warning timeout
    const warningKey = `${userId}_warning`;
    if (this.timeoutIntervals.has(warningKey)) {
      clearTimeout(this.timeoutIntervals.get(warningKey));
      this.timeoutIntervals.delete(warningKey);
    }

    // Clear cleanup timeout
    const cleanupKey = `${userId}_cleanup`;
    if (this.cleanupIntervals.has(cleanupKey)) {
      clearTimeout(this.cleanupIntervals.get(cleanupKey));
      this.cleanupIntervals.delete(cleanupKey);
    }

    // Clear stored monitoring info
    this.clearCartMonitoringInfo(userId);
  }

  // Send cart warning notification (45 minutes)
  async sendCartWarningNotification(userId) {
    try {
      // Use the singleton instance instead of creating a new one
      await NotificationService.sendCartWarningNotification(userId);
      
      // Also store in database for in-app notifications
      await this.storeInAppNotification(userId, {
        title: 'Cart Timeout Warning',
        body: 'Your cart items will be cleared in 24 hours if not ordered.',
        type: 'cart_warning'
      });

    } catch (error) {
      console.error('Error sending cart warning notification:', error);
    }
  }

  // Clear expired cart (24 hours)
  async clearExpiredCart(userId) {
    try {
      // Clear cart from database
      const { error } = await supabase
        .from('cart_items')
        .delete()
        .eq('user_id', userId);

      if (error) {
        console.error('Error clearing expired cart:', error);
        return;
      }

      // Send cart cleared notification
      // Use the singleton instance instead of creating a new one
      await NotificationService.sendCartClearedNotification(userId);
      
      // Store in-app notification
      await this.storeInAppNotification(userId, {
        title: 'Cart Cleared',
        body: 'Your cart has been automatically cleared after 24 hours of inactivity.',
        type: 'cart_cleared'
      });

      // Stop monitoring for this user
      this.stopCartMonitoring(userId);

    } catch (error) {
      console.error('Error clearing expired cart:', error);
    }
  }

  // Store cart monitoring info in AsyncStorage
  async storeCartMonitoringInfo(userId, cartStartTime) {
    try {
      const monitoringInfo = {
        userId,
        cartStartTime: cartStartTime.toISOString(),
        warningSent: false,
        cleanupScheduled: true
      };

      await AsyncStorage.setItem(
        `cart_monitoring_${userId}`,
        JSON.stringify(monitoringInfo)
      );
    } catch (error) {
      console.error('Error storing cart monitoring info:', error);
    }
  }

  // Clear cart monitoring info from AsyncStorage
  async clearCartMonitoringInfo(userId) {
    try {
      await AsyncStorage.removeItem(`cart_monitoring_${userId}`);
    } catch (error) {
      console.error('Error clearing cart monitoring info:', error);
    }
  }

  // Store in-app notification
  async storeInAppNotification(userId, notification) {
    try {
      const { error } = await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          title: notification.title,
          body: notification.body,
          type: notification.type,
          is_read: false,
          data: notification.data || {}
        });

      if (error) {
        console.error('Error storing in-app notification:', error);
      }
    } catch (error) {
      console.error('Error storing in-app notification:', error);
    }
  }

  // Check if user has cart items
  async hasCartItems(userId) {
    try {
      const { data, error } = await supabase
        .from('cart_items')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      if (error) {
        if (error.code === 'PGRST205') {
          return false;
        }
        console.error('Error checking cart items:', error);
        return false;
      }

      return data && data.length > 0;
    } catch (error) {
      console.error('Error checking cart items:', error);
      return false;
    }
  }

  // Get cart age for a user
  async getCartAge(userId) {
    try {
      const { data: cartItems, error } = await supabase
        .from('cart_items')
        .select('created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1);

      if (error || !cartItems || cartItems.length === 0) {
        return null;
      }

      const cartStartTime = new Date(cartItems[0].created_at);
      const now = new Date();
      return now - cartStartTime;
    } catch (error) {
      console.error('Error getting cart age:', error);
      return null;
    }
  }

  // Cleanup all monitoring (for app shutdown)
  cleanup() {
    // Clear all timeouts
    this.timeoutIntervals.forEach((timeout) => clearTimeout(timeout));
    this.cleanupIntervals.forEach((timeout) => clearTimeout(timeout));
    
    // Clear maps
    this.timeoutIntervals.clear();
    this.cleanupIntervals.clear();
  }
}

// Export singleton instance
export const cartTimeoutService = new CartTimeoutService();
export default cartTimeoutService;

