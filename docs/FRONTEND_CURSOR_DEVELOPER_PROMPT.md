# Cursor AI Agent Prompt: Mobile Push Notifications (Strict Firebase FCM for Android & iOS)

> **Instructions for Developer**: Copy and paste the prompt below directly into your Cursor AI Agent window.

---

```markdown
# TASK: Implement & Enforce Strict Firebase Cloud Messaging (FCM) & OEM Permission Resume (Android & iOS)

We are strictly standardizing **Firebase Cloud Messaging (FCM)** via Firebase Project `hungertap-b1ee9` for **both Android and iOS** push notifications in `hungertap_app-main`. 

This implementation fixes the **Motorola/OEM settings redirect permission bug**, standardizes tokens saved in Supabase `public.user_tokens`, and enables deep-link navigation on notification tap.

---

## 1. Motorola & OEM Android Permission Resume Fix (Deep Dive)

### The OEM Problem:
On Motorola, Xiaomi, Vivo, and Oppo Android devices, requesting notification permissions redirects the user **out of the app** into Android System Settings. Standard Expo applications fail to register push tokens because permission checks only run once during initial component mount. When the user enables notifications in System Settings and returns to HungerTap, the app remains unaware of the permission change.

### The Solution (`App.js`):
Implement an `AppState` listener watching for `nextState === 'active'`:
1. When the user returns from Android Settings, the app transitions to `active`.
2. The listener triggers an immediate re-check of `Notifications.getPermissionsAsync()`.
3. If permissions are now `granted`, it immediately executes `maybeRegisterPushToken()`, generates the FCM token, and sets `is_enabled = true` in Supabase `user_tokens`.

```javascript
// App.js Implementation Pattern
useEffect(() => {
  const handleAppStateChange = async (nextAppState) => {
    if (nextAppState === 'active' && user?.id) {
      const { status } = await Notifications.getPermissionsAsync();
      if (status === 'granted') {
        console.log('🔄 App resumed — retrying FCM token registration (permission granted)');
        await registerForPushNotificationsAsync(user.id);
        await updatePushTokenStatusInSupabase(user.id, true);
      } else if (status === 'denied') {
        await updatePushTokenStatusInSupabase(user.id, false);
      }
    }
  };

  const subscription = AppState.addEventListener('change', handleAppStateChange);
  return () => subscription.remove();
}, [user?.id]);
```

---

## 2. Unified Firebase & APNs Architecture

- **Firebase Project**: `hungertap-b1ee9` (Unified backend for both Android & iOS).
- **Android Configuration**: Configured via `./google-services.json` (`package_name: com.hungertap.app`).
- **iOS Configuration**: Configured via `./GoogleService-Info.plist` (`BUNDLE_ID: com.hungertap.app`).
- **Apple APNs Bridge**: Production APNs Auth Key (`.p8`) is uploaded to Firebase Console under *Project Settings -> Cloud Messaging -> Apple app configuration*. Firebase routes payloads directly through APNs to iOS physical devices.

---

## 3. Token Generation & Native FCM Contract (`lib/services/notifications.js`)

- **CRITICAL BACKEND REQUIREMENT**: Backend `hyper-function` uses Firebase Admin SDK (`admin.messaging().sendEachForMulticast(message)`) directly and **explicitly filters out Expo tokens** (`.filter((token) => !!token && !token.startsWith('ExponentPushToken'))`).
- **Use `getDevicePushTokenAsync()`**: The app MUST use `Notifications.getDevicePushTokenAsync()` to generate native FCM tokens for both Android and iOS instead of `getExpoPushTokenAsync()`.
- **Strict Backend-Only Push Notifications**: The frontend client app MUST **NOT** schedule or present local push notifications (e.g. `scheduleNotificationAsync`) when an order is placed. All push notifications (order placement confirmation, preparing, ready for pickup, completed) are dispatched **strictly by backend database triggers and Supabase Edge Functions (`hyper-function`)**. The client app is strictly responsible for registering native push tokens and listening for incoming push banners.
- **Database Upsert**:

  ```javascript
  const deviceTokenResponse = await Notifications.getDevicePushTokenAsync();
  const tokenValue = deviceTokenResponse?.data || null;

  const { error } = await supabase.from('user_tokens').upsert(
    {
      user_id: userId,
      fcm_token: tokenValue, // Native raw FCM token (NOT ExponentPushToken)
      platform: Platform.OS,  // 'android' | 'ios'
      is_enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'fcm_token' }
  );
  ```
- **Token Rotation**: Use `setupPushTokenRefreshListener(userId)` subscribing to `Notifications.addPushTokenListener` to automatically sync token updates to Supabase when the OS rotates tokens.

---

## 4. Banner Tap Deep-Link Navigation (`App.js`)

- Create and export a top-level `navigationRef = createNavigationContainerRef()`.
- Attach `ref={navigationRef}` to `<NavigationContainer>`.
- Wire `Notifications.addNotificationResponseReceivedListener` to parse payload data (`orderId`, `order_token`) and navigate:
  ```javascript
  navigationRef.navigate('OrderStatusScreen', { orderId, order_token });
  ```

---

## 5. Configuration Manifest (`app.json`)

Ensure both platform configurations and background notification modes are declared:

```json
{
  "expo": {
    "name": "HungerTap",
    "slug": "canteen-app",
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.hungertap.app",
      "googleServicesFile": "./GoogleService-Info.plist",
      "infoPlist": {
        "UIBackgroundModes": [
          "fetch",
          "remote-notification"
        ]
      }
    },
    "android": {
      "package": "com.hungertap.app",
      "googleServicesFile": "./google-services.json",
      "permissions": [
        "INTERNET",
        "VIBRATE",
        "RECEIVE_BOOT_COMPLETED",
        "POST_NOTIFICATIONS"
      ]
    }
  }
}
```

---

## 6. Takeaway Fee Calculation & Fallback Rules (`lib/cartRules.js`)

- **Takeaway Fee Rate**: ₹10 per non-beverage item unit (`TAKEAWAY_FEE_PER_ITEM = 10`) when `isTakeaway = true`.
- **Beverage Exclusion**: Beverages (tea, coffee, juice, shake, water, cola, etc.) matched via `isBeverageCartLine(item)` are strictly **exempt** from takeaway charges.
- **Payable Total Formula**:
  $$\text{Payable Total} = \text{Subtotal} + \text{Takeaway Fee}$$
  ```javascript
  export function takeawayChargeForLines(lines, isTakeaway = false) {
    if (!isTakeaway || !Array.isArray(lines)) return 0;
    const units = lines.reduce((total, item) => {
      if (isBeverageCartLine(item)) return total;
      return total + (Number(item?.quantity) || 1);
    }, 0);
    return units * TAKEAWAY_FEE_PER_ITEM; // ₹10 x non-beverage quantity
  }
  ```

- **Order Total Cap & Fallback**:
  - Hard cap at **₹2000** (`CART_MAX_ORDER_TOTAL = 2000`).
  - Cart operations (adding items, incrementing quantity, toggling takeaway mode) MUST run `wouldExceedMaxOrderTotal(nextCart, isTakeaway)` as a fallback check. If true, fail gracefully with: `Maximum order value is ₹2000. Remove some items before adding more.`

---

## 7. Order Placement Rate Limiting & User Guidance (`lib/orderFlowErrors.js`)

- **Backend Rate Limit Policies**: The backend database function enforces anti-spam rules for order creation (per-student cooldowns, sliding-window frequency caps, and maximum active non-terminal order limits).

- **Generalized User Messaging**: Do **NOT** expose hardcoded numerical parameters (e.g. exact seconds or exact order counts) in user-facing toasts or alerts. Use clean, generalized, user-friendly statements:
  - **Cooldown / Rapid Clicks**: `"Please wait a few seconds before placing another order."`
  - **High Frequency / Sliding Window Cap**: `"You are placing orders too quickly. Please try again shortly."`
  - **Active Order Limit Reached**: `"You have reached the limit for active orders. Please wait for your pending orders to complete before placing a new one."`

---

## 8. Verification Checklist

1. **Motorola Test**: Trigger permission prompt $\rightarrow$ tap "Open Settings" $\rightarrow$ enable notifications $\rightarrow$ return to app $\rightarrow$ verify `user_tokens` row created with `platform: 'android'` and `is_enabled: true`.
2. **iOS Test**: Launch on iPhone $\rightarrow$ grant permission $\rightarrow$ verify `user_tokens` row created with `platform: 'ios'` and `fcm_token: 'ExponentPushToken[...]'`.
3. **Banner Tap Test**: Send notification payload $\rightarrow$ tap banner $\rightarrow$ app opens directly to `OrderStatusScreen`.
4. **Takeaway Calculation Test**: Add 2 Food items & 1 Tea beverage to cart $\rightarrow$ toggle Takeaway ON $\rightarrow$ verify takeaway fee is ₹20 (2 x ₹10 for food, ₹0 for beverage).
5. **Rate Limit Feedback Test**: Attempt placing multiple rapid orders $\rightarrow$ verify generalized user toast `"Please wait a few seconds before placing another order."` (no raw seconds/counts exposed).
```
