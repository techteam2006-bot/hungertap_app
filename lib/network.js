/**
 * Network helpers — one place for "is this a connectivity problem?" and the
 * copy we show for it.
 *
 * Why this exists: React Native's fetch has NO timeout, and the Supabase client
 * did not set one either. On a weak signal a request could hang for minutes,
 * so buttons (e.g. Sign out) looked like they did nothing. Every Supabase call
 * now goes through `fetchWithTimeout` (see lib/supabase.js), and screens use
 * `friendlyErrorMessage` / `isNetworkError` to tell the user clearly.
 */
import { CONFIG } from '../config';
import { isNetworkConnectivityFailure } from './orderFlowErrors';

/** Shown whenever a request fails because of no / weak internet. */
export const NETWORK_ERROR_TITLE = 'No internet connection';
export const NETWORK_ERROR_MESSAGE =
  "Your internet connection looks weak or offline. Please check your connection and try again.";

/** Supabase REST / auth / functions requests give up after this long. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 25000;

/**
 * fetch() with a timeout. A timeout rejects with a TypeError whose message
 * contains "Network request timed out", so existing network-error checks
 * (and supabase-js, which wraps fetch errors) treat it as a connectivity failure.
 * If the caller passes its own AbortSignal, that signal is respected as well.
 */
export function fetchWithTimeout(input, init = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const callerSignal = init && init.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener?.('abort', () => controller.abort());
  }

  return fetch(input, { ...init, signal: controller.signal })
    .catch((e) => {
      if (timedOut) throw new TypeError('Network request timed out');
      throw e;
    })
    .finally(() => clearTimeout(timer));
}

/**
 * Reject if `promise` takes longer than `ms`. The underlying work is not
 * cancelled — use for non-critical steps that must not block the UI.
 */
export function withTimeout(promise, ms, label = 'Request') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TypeError(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** True for offline / timeout / DNS / gateway-type failures (Error, Supabase error object or string). */
export function isNetworkError(error) {
  if (!error) return false;
  if (isNetworkConnectivityFailure(error)) return true;
  const text = String(
    typeof error === 'object'
      ? `${error.name || ''} ${error.message || ''} ${error.details || ''}`
      : error
  ).toLowerCase();
  return (
    text.includes('aborterror') ||
    text.includes('authretryablefetcherror') ||
    text.includes('timed out')
  );
}

/**
 * Plain message for an Alert / inline error: the network message for
 * connectivity failures, otherwise `fallback`.
 */
export function friendlyErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  return fallback;
}

/**
 * Quick "can we reach our backend?" check (Supabase auth health, ~6s max).
 * Returns false on no internet, timeouts and 5xx gateway errors.
 */
export async function isBackendReachable(timeoutMs = 6000) {
  const base = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) return false;
  try {
    const res = await fetchWithTimeout(
      `${base}/auth/v1/health`,
      { method: 'GET', headers: { apikey: CONFIG.SUPABASE_ANON_KEY || '' } },
      timeoutMs
    );
    return res.status < 500;
  } catch (_) {
    return false;
  }
}
