import { isPaymentSdkLaunchFailureMessage } from './paymentLaunchErrors';

/**
 * Razorpay React Native Standard SDK adapter (react-native-razorpay). *
 * Probes NativeModules before require() so Expo Go / unlinked builds do not crash.
 * Native checkout needs a custom Expo/EAS development or production build.
 *
 * @see https://github.com/razorpay/react-native-razorpay
 */

function hasNativeModule() {
  try {
    const { NativeModules, TurboModuleRegistry } = require('react-native');
    if (NativeModules?.RNRazorpayCheckout) return true;
    if (NativeModules?.RazorpayCheckout) return true;
    return (
      TurboModuleRegistry?.get?.('RNRazorpayCheckout') != null ||
      TurboModuleRegistry?.get?.('RazorpayCheckout') != null
    );
  } catch (_) {
    return false;
  }
}

function getOpen() {
  if (!hasNativeModule()) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(
        '[Razorpay] Native SDK not linked in this runtime (Expo Go, or a build made before the package was added).'
      );
    }
    return null;
  }
  try {
    const mod = require('react-native-razorpay');
    const checkout = mod?.default || mod;
    if (checkout && typeof checkout.open === 'function') {
      return checkout.open.bind(checkout);
    }
    if (typeof mod?.open === 'function') return mod.open.bind(mod);
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Razorpay] SDK failed to load:', e?.message || e);
    }
  }
  return null;
}

export function isRazorpayNativeSdkAvailable() {
  return getOpen() != null;
}

export function describeRazorpaySdkAvailability() {
  if (!hasNativeModule()) {
    return 'RNRazorpayCheckout not registered — this runtime does not contain the Razorpay SDK (Expo Go, or build before package was added).';
  }
  if (!getOpen()) {
    return 'Native module present, but react-native-razorpay open() export is missing.';
  }
  return 'Razorpay SDK is available.';
}

/** Tokens that mean the payer dismissed checkout rather than a launch failure. */
const CANCEL_TOKENS = ['cancel', 'cancelled', 'user_cancelled', 'back', 'dismiss', 'aborted'];

function describeRazorpayError(error) {
  if (!error) return '';
  if (typeof error === 'string') return error.toLowerCase();
  return [
    error?.code,
    error?.description,
    error?.error?.description,
    error?.error?.reason,
    error?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Razorpay native SDK could not open checkout (missing module, Play Store check,
 * init failure on sideloaded APKs, etc.).
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRazorpayLaunchFailureError(error) {
  const blob = describeRazorpayError(error);
  if (!blob) return false;
  if (isPaymentSdkLaunchFailureMessage(blob)) return true;
  if (blob.includes('network_error') && blob.includes('init')) return true;
  if (String(error?.code) === 'NETWORK_ERROR') return true;
  return false;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRazorpayUserCancelError(error) {
  if (!error) return false;
  if (isRazorpayLaunchFailureError(error)) return false;
  const blob = describeRazorpayError(error);
  if (!blob) return false;
  // Razorpay often uses code 0 / 2 for user back-press.
  if (String(error?.code) === '0' || String(error?.code) === '2') {
    if (CANCEL_TOKENS.some((t) => blob.includes(t)) || blob.includes('payment cancelled')) return true;
  }
  return CANCEL_TOKENS.some((t) => blob.includes(t));
}

/**
 * Launch Razorpay Standard Checkout.
 *
 * @param {{
 *   keyId: string,
 *   razorpayOrderId: string,
 *   amountPaise: number | string,
 *   currency?: string,
 *   name?: string,
 *   description?: string,
 *   prefill?: { email?: string, contact?: string, name?: string },
 *   notes?: Record<string, string>,
 * }} opts
 * @returns {Promise<{
 *   ok: boolean,
 *   launchFailed: boolean,
 *   cancelled: boolean,
 *   payload: {
 *     razorpay_order_id?: string,
 *     razorpay_payment_id?: string,
 *     razorpay_signature?: string,
 *   } | null,
 *   error?: string,
 * }>}
 */
export async function startRazorpayCheckout(opts) {
  const open = getOpen();
  if (!open) {
    return {
      ok: false,
      launchFailed: true,
      cancelled: false,
      payload: null,
      error: 'RAZORPAY_NATIVE_SDK_NOT_AVAILABLE',
    };
  }

  const keyId = String(opts?.keyId || '').trim();
  const orderId = String(opts?.razorpayOrderId || '').trim();
  const amount = String(opts?.amountPaise ?? '').trim();
  if (!keyId || !orderId || !amount) {
    return {
      ok: false,
      launchFailed: true,
      cancelled: false,
      payload: null,
      error: 'RAZORPAY_MISSING_CHECKOUT_PARAMS',
    };
  }

  const options = {
    key: keyId,
    amount,
    currency: String(opts?.currency || 'INR').toUpperCase(),
    order_id: orderId,
    name: opts?.name || 'HungerTap',
    description: opts?.description || 'HungerTap order',
    theme: { color: '#FFB301' },
    ...(opts?.prefill ? { prefill: opts.prefill } : {}),
    ...(opts?.notes ? { notes: opts.notes } : {}),
  };

  try {
    const data = await open(options);
    return {
      ok: true,
      launchFailed: false,
      cancelled: false,
      payload: {
        razorpay_order_id: data?.razorpay_order_id || orderId,
        razorpay_payment_id: data?.razorpay_payment_id,
        razorpay_signature: data?.razorpay_signature,
      },
    };
  } catch (e) {
    if (isRazorpayUserCancelError(e)) {
      return {
        ok: false,
        launchFailed: false,
        cancelled: true,
        payload: null,
        error: e?.description || e?.message || 'cancelled',
      };
    }
    const code = String(e?.code || '').trim();
    const launchFailed =
      isRazorpayLaunchFailureError(e) ||
      code === 'NETWORK_ERROR' ||
      String(e?.error || '')
        .toLowerCase()
        .includes('init') ||
      !hasNativeModule();
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Razorpay] checkout rejected:', code || e?.description || e?.message || e);
    }
    return {
      ok: false,
      launchFailed,
      cancelled: false,
      payload: null,
      error: e?.description || e?.message || code || 'RAZORPAY_CHECKOUT_FAILED',
    };
  }
}
