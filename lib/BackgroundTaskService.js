import { supabase } from './supabase';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { Platform } from 'react-native';

const BACKGROUND_FETCH_TASK = 'background-cart-cleanup';

class BackgroundTaskService {
  constructor() {
    this.isInitialized = false;
  }

  // Initialize background tasks
  async initialize() {
    if (this.isInitialized) return true;

    try {
      // Define the background task
      TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
        try {
          console.log('Running background cart cleanup task...');
          await this.runCartCleanupTask();
          return BackgroundFetch.BackgroundFetchResult.NewData;
        } catch (error) {
          console.error('Background cart cleanup task failed:', error);
          return BackgroundFetch.BackgroundFetchResult.Failed;
        }
      });

      // Register background fetch
      await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
        minimumInterval: 15 * 60 * 1000, // 15 minutes minimum interval
        stopOnTerminate: false,
        startOnBoot: true,
      });

      this.isInitialized = true;
      console.log('Background task service initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize background task service:', error);
      return false;
    }
  }

  // Run cart cleanup task
  async runCartCleanupTask() {
    try {
      console.log('Starting cart cleanup task...');

      // Call the database function to clear expired carts
      const { data, error } = await supabase.rpc('clear_expired_carts');
      
      if (error) {
        console.error('Error clearing expired carts:', error);
        return;
      }

      const clearedCount = data || 0;
      console.log(`Cleared ${clearedCount} expired carts`);

      // Call the database function to send cart warnings
      const { data: warningData, error: warningError } = await supabase.rpc('send_cart_warnings');
      
      if (warningError) {
        console.error('Error sending cart warnings:', warningError);
        return;
      }

      const warningCount = warningData || 0;
      console.log(`Sent ${warningCount} cart warnings`);

    } catch (error) {
      console.error('Cart cleanup task error:', error);
    }
  }

  // Check if background fetch is available
  async isBackgroundFetchAvailable() {
    try {
      const status = await BackgroundFetch.getStatusAsync();
      return status === BackgroundFetch.BackgroundFetchStatus.Available;
    } catch (error) {
      console.error('Error checking background fetch status:', error);
      return false;
    }
  }

  // Get background fetch status
  async getBackgroundFetchStatus() {
    try {
      const status = await BackgroundFetch.getStatusAsync();
      return status;
    } catch (error) {
      console.error('Error getting background fetch status:', error);
      return null;
    }
  }

  // Unregister background tasks
  async unregister() {
    try {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
      console.log('Background tasks unregistered');
    } catch (error) {
      console.error('Error unregistering background tasks:', error);
    }
  }
}

// Export singleton instance
export const backgroundTaskService = new BackgroundTaskService();
export default backgroundTaskService;

