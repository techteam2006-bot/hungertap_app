import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';

const BACKGROUND_FETCH_TASK = 'background-cart-cleanup';

/**
 * Cart is device-local by default (`EXPO_PUBLIC_CART_STORAGE=local`).
 * Remote cart RPCs (`clear_expired_carts` / `send_cart_warnings`) are not deployed —
 * this task is a no-op placeholder so background registration stays harmless.
 */
class BackgroundTaskService {
  constructor() {
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return true;

    try {
      const status = await BackgroundFetch.getStatusAsync();
      if (
        status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
        status === BackgroundFetch.BackgroundFetchStatus.Denied
      ) {
        console.warn('Background fetch unavailable on this device; skipping registration.');
        return false;
      }

      TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
        try {
          await this.runCartCleanupTask();
          return BackgroundFetch.BackgroundFetchResult.NoData;
        } catch (error) {
          console.error('Background cart cleanup task failed:', error);
          return BackgroundFetch.BackgroundFetchResult.Failed;
        }
      });

      await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
        minimumInterval: 15 * 60 * 1000,
        stopOnTerminate: false,
        startOnBoot: true,
      });

      this.isInitialized = true;
      return true;
    } catch (error) {
      const msg = String(error?.message || error || '');
      if (msg.toLowerCase().includes('uibackgroundmodes') || msg.toLowerCase().includes('background fetch')) {
        console.warn(
          'Background fetch not enabled in Info.plist yet. Rebuild the iOS app after updating app.json.'
        );
        return false;
      }
      console.error('Failed to initialize background task service:', error);
      return false;
    }
  }

  async runCartCleanupTask() {
    // Local carts expire on-device; nothing to call on Supabase.
    return;
  }

  async isBackgroundFetchAvailable() {
    try {
      const status = await BackgroundFetch.getStatusAsync();
      return status === BackgroundFetch.BackgroundFetchStatus.Available;
    } catch (error) {
      console.error('Error checking background fetch status:', error);
      return false;
    }
  }

  async getBackgroundFetchStatus() {
    try {
      return await BackgroundFetch.getStatusAsync();
    } catch (error) {
      console.error('Error getting background fetch status:', error);
      return null;
    }
  }

  async unregister() {
    try {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
      this.isInitialized = false;
      return true;
    } catch (error) {
      console.error('Failed to unregister background tasks:', error);
      return false;
    }
  }
}

const backgroundTaskService = new BackgroundTaskService();
export { backgroundTaskService };
export default backgroundTaskService;
