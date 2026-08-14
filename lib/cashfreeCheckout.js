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

    const CFPaymentGatewayService = sdk?.CFPaymentGatewayService || sdk?.default?.CFPaymentGatewayService;
    const CFSession = contract?.CFSession || contract?.default?.CFSession;
    const CFEnvironment = contract?.CFEnvironment || contract?.default?.CFEnvironment;
    const CFDropCheckoutPayment = contract?.CFDropCheckoutPayment || contract?.default?.CFDropCheckoutPayment;
    const CFPaymentComponentBuilder = contract?.CFPaymentComponentBuilder || contract?.default?.CFPaymentComponentBuilder;
    const CFPaymentModes = contract?.CFPaymentModes || contract?.default?.CFPaymentModes;
    const CFThemeBuilder = contract?.CFThemeBuilder || contract?.default?.CFThemeBuilder;

    if (CFPaymentGatewayService && CFSession && CFEnvironment && CFDropCheckoutPayment) {
      return {
        CFPaymentGatewayService,
        CFSession,
        CFEnvironment,
        CFDropCheckoutPayment,
        CFPaymentComponentBuilder,
        CFPaymentModes,
        CFThemeBuilder,
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
 * Diagnostic: says *why* the SDK is unavailable, so a build problem
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
    const CFPaymentGatewayService = sdk?.CFPaymentGatewayService || sdk?.default?.CFPaymentGatewayService;
    const CFSession = contract?.CFSession || contract?.default?.CFSession;
    const CFEnvironment = contract?.CFEnvironment || contract?.default?.CFEnvironment;

    const missing = [];
    if (!CFPaymentGatewayService) missing.push('CFPaymentGatewayService');
    if (!CFSession) missing.push('CFSession');
    if (!CFEnvironment) missing.push('CFEnvironment');
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

/** Tokens that mark an onError as the payer backing out rather than a launch failure. */
const CANCEL_TOKENS = ['cancel', 'user_dropped', 'back_press', 'aborted'];

/**
 * Read a field off a CFErrorResponse. Its properties are `private` in the SDK's
 * TypeScript, which is compile-time only — at runtime both the plain property
 * and the getter are present, but which one survives depends on the build, so
 * try the getter first and fall back to the property.
 */
function readErrorField(error, key, getter) {
  try {
    if (typeof error?.[getter] === 'function') {
      const v = error[getter]();
      if (v != null) return String(v);
    }
  } catch (_) {
    /* fall through to the raw property */
  }
  return error?.[key] != null ? String(error[key]) : '';
}

/**
 * Flatten a CFErrorResponse into one lowercased string for classification and logs.
 * @returns {string}
 */
export function describeCashfreeSdkError(error) {
  if (!error) return '';
  if (typeof error === 'string') return error.toLowerCase();
  return [
    readErrorField(error, 'status', 'getStatus'),
    readErrorField(error, 'code', 'getCode'),
    readErrorField(error, 'type', 'getType'),
    readErrorField(error, 'message', 'getMessage'),
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

/**
 * Did the payer dismiss the native checkout themselves?
 *
 * A cancel must not be retried in the WebView — that would reopen a checkout the
 * user just closed. Only a genuine launch/session failure should fall back.
 * @returns {boolean}
 */
export function isCashfreeUserCancelError(error) {
  const blob = describeCashfreeSdkError(error);
  if (!blob) return false;
  return CANCEL_TOKENS.some((t) => blob.includes(t));
}

/**
 * Start the Cashfree native checkout UI.
 *
 * Throws a tagged Error the caller can branch on rather than letting CFSession's
 * own messages ("sessionID cannot be empty") surface as a generic launch failure.
 *
 * @param {{ paymentSessionId: string, orderId: string, environment?: 'SANDBOX' | 'PRODUCTION' }} opts
 */
export function startCashfreeCheckout({ paymentSessionId, orderId, environment = 'SANDBOX' }) {
  const sdk = getSDK();
  if (!sdk) {
    throw new Error('CASHFREE_NATIVE_SDK_NOT_AVAILABLE');
  }

  const sessionId = String(paymentSessionId || '').trim();
  const cfOrderId = String(orderId || '').trim();
  if (!sessionId) throw new Error('CASHFREE_MISSING_SESSION_ID');
  if (!cfOrderId) throw new Error('CASHFREE_MISSING_ORDER_ID');

  // CFSession stores `CFEnvironment[environment]`, i.e. it looks the value up by
  // enum *key*. It must receive 'SANDBOX' or 'PRODUCTION' exactly — anything
  // else resolves to undefined and Cashfree rejects the session on open.
  const cfEnvironment =
    String(environment).trim().toUpperCase() === 'PRODUCTION'
      ? sdk.CFEnvironment.PRODUCTION
      : sdk.CFEnvironment.SANDBOX;

  const session = new sdk.CFSession(sessionId, cfOrderId, cfEnvironment);

  const componentBuilder = new sdk.CFPaymentComponentBuilder();
  if (typeof componentBuilder.enableAllModes === 'function') {
    componentBuilder.enableAllModes();
  }
  if (sdk.CFPaymentModes && typeof componentBuilder.addPaymentMethod === 'function') {
    if (sdk.CFPaymentModes.UPI) componentBuilder.addPaymentMethod(sdk.CFPaymentModes.UPI);
    if (sdk.CFPaymentModes.CARD) componentBuilder.addPaymentMethod(sdk.CFPaymentModes.CARD);
    if (sdk.CFPaymentModes.NB) componentBuilder.addPaymentMethod(sdk.CFPaymentModes.NB);
    if (sdk.CFPaymentModes.WALLET) componentBuilder.addPaymentMethod(sdk.CFPaymentModes.WALLET);
    if (sdk.CFPaymentModes.PAY_LATER) componentBuilder.addPaymentMethod(sdk.CFPaymentModes.PAY_LATER);
  }
  const component = componentBuilder.build();

  let theme = null;
  if (sdk.CFThemeBuilder) {
    theme = new sdk.CFThemeBuilder()
      .setNavigationBarBackgroundColor('#FFB301')
      .setNavigationBarTextColor('#1A1A1A')
      .setButtonBackgroundColor('#FFB301')
      .setButtonTextColor('#000000')
      .setPrimaryTextColor('#1A1A1A')
      .setSecondaryTextColor('#555555')
      .setBackgroundColor('#FFFFFF')
      .build();
  }

  const dropPayment = new sdk.CFDropCheckoutPayment(session, component, theme);
  sdk.CFPaymentGatewayService.doPayment(dropPayment);
}
