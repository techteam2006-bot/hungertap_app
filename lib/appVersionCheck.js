import { Platform } from 'react-native';
import { CONFIG } from '../config';
import { supabase } from './supabase';
import { isNetworkConnectivityFailure } from './orderFlowErrors';
import { compareVersions, getInstalledAppVersion, isVersionBelowMinimum } from './appVersion';

/**
 * Remote minimum version policy.
 *
 * Fail-open on network/RPC errors (same spirit as canteen status checks) so a
 * temporary outage does not lock every user out. Fail-closed only when the
 * server returns a minimum and the installed build is below it.
 */

export async function fetchMinimumSupportedVersion(platform = Platform.OS) {
  const envOverride = String(process.env.EXPO_PUBLIC_MIN_SUPPORTED_VERSION || '').trim();
  if (envOverride) {
    return { ok: true, minimumVersion: envOverride, source: 'env' };
  }

  const pPlatform = platform === 'ios' ? 'ios' : 'android';

  try {
    const { data, error } = await supabase.rpc('get_minimum_supported_app_version', {
      p_platform: pPlatform,
    });

    if (error) {
      return {
        ok: false,
        errorKind: isNetworkConnectivityFailure(error) ? 'network' : 'fetch',
        error: error.message || String(error),
      };
    }

    const row = data && typeof data === 'object' ? data : {};
    const minimumVersion = String(row.minimum_version || row.minimumVersion || '0.0.0').trim();

    return { ok: true, minimumVersion, source: 'server' };
  } catch (e) {
    return {
      ok: false,
      errorKind: isNetworkConnectivityFailure(e) ? 'network' : 'fetch',
      error: e?.message || String(e),
    };
  }
}

/**
 * @returns {Promise<{
 *   required: boolean,
 *   installed: string,
 *   minimumVersion: string|null,
 *   checkFailed: boolean,
 *   errorKind?: string,
 * }>}
 */
export async function evaluateForceUpdateRequired() {
  const installed = getInstalledAppVersion();
  const remote = await fetchMinimumSupportedVersion();

  if (!remote.ok) {
    return {
      required: false,
      installed,
      minimumVersion: null,
      checkFailed: true,
      errorKind: remote.errorKind,
    };
  }

  const minimumVersion = remote.minimumVersion;
  const required = isVersionBelowMinimum(installed, minimumVersion);

  return {
    required,
    installed,
    minimumVersion,
    checkFailed: false,
  };
}

/** Exported for unit-style manual verification in dev logs. */
export { compareVersions, getInstalledAppVersion, isVersionBelowMinimum };

export const PLAY_STORE_URL = CONFIG.PLAY_STORE_URL;
