/**
 * Easebuzz React Native SDK adapter (react-native-easebuzz-sdk).
 *
 * Wraps initializeEasebuzzCheckout so PaymentProcessingScreen can launch the
 * native Easebuzz checkout UI without crashing in Expo Go.
 *
 * IMPORTANT: Native checkout requires a custom Expo/EAS development build.
 * The package throws at import time when the native module is missing, so it
 * must only ever be reached through the lazy require below.
 */

import { NativeModules, TurboModuleRegistry } from 'react-native';

/**
 * Probe the native registry WITHOUT importing the package.
 *
 * `react-native-easebuzz-sdk` throws from its module factory when the native
 * module is missing, and Metro reports factory throws to the global error
 * handler before rethrowing — so a plain try/catch around `require` still
 * surfaces a fatal error. Checking here first means the factory never runs in
 * runtimes that cannot support it.
 */
function hasNativeModule() {
  try {
    if (NativeModules?.EasebuzzSdk) return true;
    // `get` (unlike `getEnforcing`) returns null instead of throwing.
    return TurboModuleRegistry?.get?.('EasebuzzSdk') != null;
  } catch (_) {
    return false;
  }
}

function getSDK() {
  if (!hasNativeModule()) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Easebuzz] Native SDK not linked in this runtime (Expo Go, or a build made before the package was added).');
    }
    return null;
  }
  try {
    const sdk = require('react-native-easebuzz-sdk');
    const open = sdk?.initializeEasebuzzCheckout || sdk?.default;
    if (typeof open === 'function') {
      return open;
    }
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Easebuzz] Native SDK failed to load:', e?.message || e);
    }
  }
  return null;
}

export function isEasebuzzNativeSdkAvailable() {
  return getSDK() != null;
}

/** Map the server-issued environment onto the SDK's pay_mode values. */
export function toEasebuzzPayMode(environment) {
  return String(environment || '').toUpperCase() === 'PRODUCTION' ? 'production' : 'test';
}

function parseSdkPayload(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return { result: String(raw) };
  }
}

/**
 * Launch the native Easebuzz checkout UI.
 *
 * The SDK resolves for any completed checkout (success, failure or user
 * cancellation) and rejects both for real payment failures and for launch
 * problems. Callers must not branch on the result strings — the `orders` row
 * stays authoritative. Only `launchFailed` is meaningful control flow: it means
 * checkout never opened, so the WebView fallback should be used instead.
 *
 * @param {{ accessKey: string, environment?: 'SANDBOX' | 'PRODUCTION' }} opts
 * @returns {Promise<{ ok: boolean, launchFailed: boolean, payload: object | null, error?: string }>}
 */
export async function startEasebuzzCheckout({ accessKey, environment }) {
  const open = getSDK();
  if (!open) {
    return {
      ok: false,
      launchFailed: true,
      payload: null,
      error: 'EASEBUZZ_NATIVE_SDK_NOT_AVAILABLE',
    };
  }

  const key = String(accessKey || '').trim();
  if (!key) {
    return { ok: false, launchFailed: true, payload: null, error: 'EASEBUZZ_MISSING_ACCESS_KEY' };
  }

  try {
    const raw = await open(key, toEasebuzzPayMode(environment));
    return { ok: true, launchFailed: false, payload: parseSdkPayload(raw) };
  } catch (e) {
    // `PAYMENT_INIT_FAILED` is raised when no activity is available to host the
    // checkout — nothing was ever shown to the user, so fall back to the WebView.
    const code = String(e?.code || '').trim();
    const launchFailed = code === 'PAYMENT_INIT_FAILED' || code === 'ERROR';
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[Easebuzz] checkout rejected:', code || e?.message || e);
    }
    return {
      ok: false,
      launchFailed,
      payload: parseSdkPayload(e?.message),
      error: code || e?.message || 'EASEBUZZ_CHECKOUT_FAILED',
    };
  }
}
