/**
 * Installs resilient global handlers so native/runtime errors surface in logs instead of failing silently.
 * Does not swallow errors — forwards to React Native's handler after logging.
 */

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
        // ✅ crash prevention added — structured log before default handling
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
        if (typeof previous === 'function') {
          previous(error, isFatal);
        }
      });
    }
  } catch (e) {
    console.error('[installGlobalErrorSafety] Unexpected Error:', e);
  }
}
