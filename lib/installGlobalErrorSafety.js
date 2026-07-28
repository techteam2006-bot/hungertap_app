/**
 * Installs resilient global handlers so native/runtime errors surface in logs
 * and are forwarded to Sentry (if initialized) then to React Native's handler.
 * Must run AFTER Sentry.init() so previous === Sentry's handler.
 */

import { Sentry } from './sentry';

// ✅ error handled
export function installGlobalErrorSafety() {
  try {
    if (
      typeof ErrorUtils !== 'undefined' &&
      typeof ErrorUtils.getGlobalHandler === 'function' &&
      typeof ErrorUtils.setGlobalHandler === 'function'
    ) {
      const previous = ErrorUtils.getGlobalHandler();
      ErrorUtils.setGlobalHandler((error, isFatal) => {
        const msg =
          error && typeof error === 'object' && 'message' in error
            ? error.message
            : String(error);
        console.error(
          '[GlobalErrorHandler]',
          isFatal ? '[fatal]' : '[non-fatal]',
          msg,
          error?.stack ?? ''
        );
        try {
          if (global.__HUNGERTAP_SENTRY_INIT__) {
            Sentry.captureException(error, {
              tags: { fatal: String(!!isFatal), handler: 'ErrorUtils' },
            });
          }
        } catch (_) {
          // never block default crash path
        }
        if (typeof previous === 'function') {
          previous(error, isFatal);
        }
      });
    }
  } catch (e) {
    console.error('[installGlobalErrorSafety] Unexpected Error:', e);
  }
}
