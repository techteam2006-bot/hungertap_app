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
    // Element (custom UI) payments — used by components/cashfree/CashfreeCheckoutSheet.js
    const CFUPIPayment = contract?.CFUPIPayment || contract?.default?.CFUPIPayment;
    const CFUPI = contract?.CFUPI || contract?.default?.CFUPI;
    const UPIMode = contract?.UPIMode || contract?.default?.UPIMode;
    const ElementCard = contract?.ElementCard || contract?.default?.ElementCard;
    const CFNB = contract?.CFNB || contract?.default?.CFNB;
    const CFNBPayment = contract?.CFNBPayment || contract?.default?.CFNBPayment;
    const CFCard = sdk?.CFCard || sdk?.default?.CFCard;

    if (CFPaymentGatewayService && CFSession && CFEnvironment && CFDropCheckoutPayment) {
      return {
        CFPaymentGatewayService,
        CFSession,
        CFEnvironment,
        CFDropCheckoutPayment,
        CFPaymentComponentBuilder,
        CFPaymentModes,
        CFThemeBuilder,
        CFUPIPayment,
        CFUPI,
        UPIMode,
        ElementCard,
        CFNB,
        CFNBPayment,
        CFCard,
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

import { isPaymentSdkLaunchFailureMessage } from './paymentLaunchErrors';
import { cfDropInTheme } from './cashfreeUiTheme';

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
  if (isCashfreeLaunchFailureError(error)) return false;
  return CANCEL_TOKENS.some((t) => blob.includes(t));
}

/**
 * Native Cashfree failed before checkout could start (Play Store / sideload check,
 * session init, etc.). WebView fallback should be used instead of failing out.
 * @returns {boolean}
 */
export function isCashfreeLaunchFailureError(error) {
  const blob = describeCashfreeSdkError(error);
  if (!blob) return false;
  if (isPaymentSdkLaunchFailureMessage(blob)) return true;
  // Cashfree-specific codes seen when Drop Checkout cannot present on sideloaded APKs.
  if (blob.includes('drop') && (blob.includes('failed') || blob.includes('error'))) return true;
  if (blob.includes('session') && blob.includes('invalid')) return true;
  return false;
}

/**
 * CFSession stores `CFEnvironment[environment]`, i.e. it looks the value up by
 * enum *key*. It must receive 'SANDBOX' or 'PRODUCTION' exactly — anything
 * else resolves to undefined and Cashfree rejects the session on open.
 */
function buildSession(sdk, { paymentSessionId, orderId, environment = 'SANDBOX' }) {
  const sessionId = String(paymentSessionId || '').trim();
  const cfOrderId = String(orderId || '').trim();
  if (!sessionId) throw new Error('CASHFREE_MISSING_SESSION_ID');
  if (!cfOrderId) throw new Error('CASHFREE_MISSING_ORDER_ID');
  const cfEnvironment =
    String(environment).trim().toUpperCase() === 'PRODUCTION'
      ? sdk.CFEnvironment.PRODUCTION
      : sdk.CFEnvironment.SANDBOX;
  return new sdk.CFSession(sessionId, cfOrderId, cfEnvironment);
}

function requireSDK() {
  const sdk = getSDK();
  if (!sdk) throw new Error('CASHFREE_NATIVE_SDK_NOT_AVAILABLE');
  return sdk;
}

/**
 * Start the Cashfree native drop-in checkout UI.
 *
 * Throws a tagged Error the caller can branch on rather than letting CFSession's
 * own messages ("sessionID cannot be empty") surface as a generic launch failure.
 *
 * @param {{ paymentSessionId: string, orderId: string, environment?: 'SANDBOX' | 'PRODUCTION', modes?: string[] }} opts
 *   `modes` limits the drop-in to e.g. ['WALLET']; omit for every mode.
 */
export function startCashfreeCheckout({ paymentSessionId, orderId, environment = 'SANDBOX', modes }) {
  const sdk = requireSDK();
  const session = buildSession(sdk, { paymentSessionId, orderId, environment });

  const componentBuilder = new sdk.CFPaymentComponentBuilder();
  const wanted = Array.isArray(modes) ? modes.filter(Boolean) : [];
  if (wanted.length && typeof componentBuilder.add === 'function' && sdk.CFPaymentModes) {
    wanted.forEach((m) => {
      const mode = sdk.CFPaymentModes[m];
      if (mode) componentBuilder.add(mode);
    });
  } else if (typeof componentBuilder.enableAllModes === 'function') {
    componentBuilder.enableAllModes();
  }
  const component = componentBuilder.build();

  let theme = null;
  if (sdk.CFThemeBuilder) {
    theme = new sdk.CFThemeBuilder()
      .setNavigationBarBackgroundColor(cfDropInTheme.navigationBarBackgroundColor)
      .setNavigationBarTextColor(cfDropInTheme.navigationBarTextColor)
      .setButtonBackgroundColor(cfDropInTheme.buttonBackgroundColor)
      .setButtonTextColor(cfDropInTheme.buttonTextColor)
      .setPrimaryTextColor(cfDropInTheme.primaryTextColor)
      .setSecondaryTextColor(cfDropInTheme.secondaryTextColor)
      .setBackgroundColor(cfDropInTheme.backgroundColor)
      .build();
  }

  const dropPayment = new sdk.CFDropCheckoutPayment(session, component, theme);
  sdk.CFPaymentGatewayService.doPayment(dropPayment);
}

/* ------------------------------------------------------------------------ */
/*  Element payments — our own UI, Cashfree only processes the payment.      */
/*  Result arrives through the same onVerify / onError callbacks as drop-in. */
/*  Needs "Seamless / Element" payments enabled on the Cashfree account.     */
/* ------------------------------------------------------------------------ */

/** True when this build can run custom-UI (Element) payments. */
export function isCashfreeElementSdkAvailable() {
  const sdk = getSDK();
  return !!(
    sdk &&
    sdk.CFUPIPayment &&
    sdk.CFUPI &&
    sdk.UPIMode &&
    sdk.ElementCard &&
    sdk.CFCard &&
    sdk.CFNB &&
    sdk.CFNBPayment
  );
}

/**
 * UPI apps installed on the phone.
 * Android returns [{ appName, appPackage }]; iOS returns [{ displayName, id }].
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export async function getCashfreeUpiApps() {
  const sdk = getSDK();
  if (!sdk || typeof sdk.CFPaymentGatewayService.getInstalledUpiApps !== 'function') return [];
  try {
    const raw = await Promise.race([
      sdk.CFPaymentGatewayService.getInstalledUpiApps(),
      new Promise((resolve) => setTimeout(() => resolve('[]'), 4000)),
    ]);
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list
      .map((a) => ({
        id: String(a?.appPackage || a?.id || a?.packageName || '').trim(),
        name: String(a?.appName || a?.displayName || a?.name || '').trim(),
      }))
      .filter((a) => a.id && !seen.has(a.id) && seen.add(a.id));
  } catch (_) {
    return [];
  }
}

/** Open a specific UPI app (intent flow). `appId` = Android package / iOS id. */
export function startCashfreeUpiIntent({ paymentSessionId, orderId, environment, appId }) {
  const sdk = requireSDK();
  const session = buildSession(sdk, { paymentSessionId, orderId, environment });
  const upi = new sdk.CFUPI(sdk.UPIMode.INTENT, String(appId || ''));
  sdk.CFPaymentGatewayService.makePayment(new sdk.CFUPIPayment(session, upi));
}

/** Send a collect request to a UPI ID (vpa). */
export function startCashfreeUpiCollect({ paymentSessionId, orderId, environment, vpa }) {
  const sdk = requireSDK();
  const session = buildSession(sdk, { paymentSessionId, orderId, environment });
  const upi = new sdk.CFUPI(sdk.UPIMode.COLLECT, String(vpa || '').trim());
  sdk.CFPaymentGatewayService.makePayment(new sdk.CFUPIPayment(session, upi));
}

/** Net banking with a Cashfree bank code (e.g. 3044 = SBI). */
export function startCashfreeNetBanking({ paymentSessionId, orderId, environment, bankCode }) {
  const sdk = requireSDK();
  if (!sdk.CFNB || !sdk.CFNBPayment) throw new Error('CASHFREE_NB_NOT_SUPPORTED');
  const session = buildSession(sdk, { paymentSessionId, orderId, environment });
  const nb = new sdk.CFNB(String(bankCode || ''));
  sdk.CFPaymentGatewayService.makePayment(new sdk.CFNBPayment(session, nb));
}

/**
 * Pieces the card screen needs. The card NUMBER must be typed into Cashfree's
 * own <CFCardInput> (PCI rule — HungerTap code never sees the full number);
 * name / expiry / CVV go in our own fields and are passed via ElementCard.
 * @returns {{ CFCardInput: any, buildCardSession: Function, makeElementCard: Function } | null}
 */
export function getCashfreeCardElement() {
  const sdk = getSDK();
  if (!sdk || !sdk.CFCard || !sdk.ElementCard) return null;
  return {
    CFCardInput: sdk.CFCard,
    buildCardSession: (opts) => buildSession(sdk, opts),
    makeElementCard: ({ name, expiryMM, expiryYY, cvv, saveCard }) =>
      new sdk.ElementCard(String(name || ''), expiryMM, expiryYY, cvv, !!saveCard),
  };
}
