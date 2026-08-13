/**
 * Cashfree React Native SDK adapter (react-native-cashfree-pg-sdk).
 *
 * Wraps CFPaymentGatewayService so PaymentProcessingScreen can launch
 * the native Cashfree checkout UI without crashing in Expo Go.
 *
 * IMPORTANT: Native checkout requires a custom Expo/EAS development build.
 */

/**
 * The SDK splits across two packages: `react-native-cashfree-pg-sdk` exposes
 * CFPaymentGatewayService, while CFSession/CFEnvironment come from
 * `cashfree-pg-api-contract`. Importing the RN package never throws when the
 * app is unlinked — it hands back a Proxy that only throws once a method is
 * called — so availability must be probed on NativeModules directly.
 */
/**
 * Under the New Architecture the legacy `NativeModules` map is a lazy proxy, so
 * a module can be linked and still miss a plain property lookup. Check the
 * TurboModule registry too — `get` returns null rather than throwing.
 */
function hasNativeModule() {
  try {
    const { NativeModules, TurboModuleRegistry } = require('react-native');
    if (NativeModules?.CashfreePgApi) return true;
    return TurboModuleRegistry?.get?.('CashfreePgApi') != null;
  } catch (_) {
    return false;
  }
}

function getSDK() {
  if (!hasNativeModule()) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Cashfree] Native SDK not linked in this runtime (Expo Go, or a build made before the package was added).');
    }
    return null;
  }

  try {
    const sdk = require('react-native-cashfree-pg-sdk');
    const contract = require('cashfree-pg-api-contract');
    if (sdk?.CFPaymentGatewayService && contract?.CFSession && contract?.CFEnvironment) {
      return {
        CFPaymentGatewayService: sdk.CFPaymentGatewayService,
        CFSession: contract.CFSession,
        CFEnvironment: contract.CFEnvironment,
      };
    }
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Cashfree] SDK packages resolved but expected exports are missing.');
    }
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Cashfree] SDK failed to load:', e?.message || e);
    }
  }
  return null;
}

export function isCashfreeNativeSdkAvailable() {
  return getSDK() != null;
}

/**
 * Dev-only diagnostic: says *why* the SDK is unavailable, so a build problem
 * can be told apart from a packaging problem without digging through logs.
 * @returns {string}
 */
export function describeCashfreeSdkAvailability() {
  if (!hasNativeModule()) {
    return 'CashfreePgApi not registered in NativeModules or TurboModuleRegistry — this runtime does not contain the Cashfree SDK (Expo Go, or a build made before the package was added).';
  }
  try {
    const sdk = require('react-native-cashfree-pg-sdk');
    const contract = require('cashfree-pg-api-contract');
    const missing = [];
    if (!sdk?.CFPaymentGatewayService) missing.push('CFPaymentGatewayService');
    if (!contract?.CFSession) missing.push('CFSession');
    if (!contract?.CFEnvironment) missing.push('CFEnvironment');
    if (missing.length) return `Native module present, but exports missing: ${missing.join(', ')}`;
    return 'Cashfree SDK is available.';
  } catch (e) {
    return `Native module present, but JS packages failed to load: ${e?.message || e}`;
  }
}

/**
 * Register the onVerify / onError callbacks.
 * Call this before startCashfreeCheckout(), typically in a useEffect.
 *
 * @param {{ onVerify: (orderId: string) => void, onError: (error: object, orderId: string) => void }} callbacks
 */
export function configureCashfreeCallbacks({ onVerify, onError }) {
  const sdk = getSDK();
  if (!sdk) return;
  try {
    sdk.CFPaymentGatewayService.setCallback({
      onVerify(orderId) {
        try {
          onVerify?.(orderId);
        } catch (e) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[Cashfree] onVerify threw:', e);
          }
        }
      },
      onError(error, orderId) {
        try {
          onError?.(error, orderId);
        } catch (e) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[Cashfree] onError threw:', e);
          }
        }
      },
    });
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Cashfree] configureCashfreeCallbacks failed:', e?.message || e);
    }
  }
}

/**
 * Remove Cashfree callbacks. Call this in the useEffect cleanup / on unmount.
 */
export function clearCashfreeCallbacks() {
  const sdk = getSDK();
  if (!sdk) return;
  try {
    sdk.CFPaymentGatewayService.removeCallback();
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Cashfree] clearCashfreeCallbacks failed:', e?.message || e);
    }
  }
}

/**
 * Start the Cashfree native checkout UI.
 *
 * @param {{ paymentSessionId: string, orderId: string, environment?: 'SANDBOX' | 'PRODUCTION' }} opts
 */
export function startCashfreeCheckout({ paymentSessionId, orderId, environment = 'SANDBOX' }) {
  const sdk = getSDK();
  if (!sdk) {
    throw new Error('CASHFREE_NATIVE_SDK_NOT_AVAILABLE');
  }
  const cfEnvironment =
    environment === 'PRODUCTION' ? sdk.CFEnvironment.PRODUCTION : sdk.CFEnvironment.SANDBOX;

  const session = new sdk.CFSession(paymentSessionId, orderId, cfEnvironment);

  sdk.CFPaymentGatewayService.doWebPayment(session);
}
