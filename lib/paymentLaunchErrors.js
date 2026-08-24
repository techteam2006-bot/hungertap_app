/**
 * Classify native payment SDK errors that mean checkout never really opened —
 * sideload / Play Store checks, init failures, missing provider, etc.
 * These should fall back to WebView rather than treating as payer cancel/failure.
 */

const LAUNCH_FAILURE_TOKENS = [
  'play store',
  'playstore',
  'play_store',
  'app store',
  'appstore',
  'app_store',
  'not installed',
  'install from',
  'installed from',
  'get it from',
  'download from',
  'package name',
  'package_name',
  'signature',
  'sideload',
  'unverified',
  'invalid app',
  'invalid application',
  'provider',
  'init failed',
  'initialization failed',
  'initialisation failed',
  'launch failed',
  'could not open',
  'unable to open',
  'failed to open',
  'cannot open',
  'merchant verification',
  'verification failed',
  'native sdk not available',
  'sdk not linked',
  'not registered',
  'activity not found',
  'no activity',
  'payment_init_failed',
];

/**
 * @param {string} blob
 * @returns {boolean}
 */
export function isPaymentSdkLaunchFailureMessage(blob) {
  const lower = String(blob || '').toLowerCase();
  if (!lower) return false;
  return LAUNCH_FAILURE_TOKENS.some((t) => lower.includes(t));
}
