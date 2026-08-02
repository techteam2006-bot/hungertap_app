/**
 * Earliest JS Sentry bootstrap — keep imports minimal so this module loads
 * before screens, providers, Supabase, Firebase, and navigation.
 */
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const isExpoGo = Constants.appOwnership === 'expo';

export function getSentryReleaseDist() {
  const version = Constants.expoConfig?.version || '1.0.0';
  const androidCode = Constants.expoConfig?.android?.versionCode;
  const dist =
    Platform.OS === 'android'
      ? String(androidCode ?? Constants.nativeBuildVersion ?? '1')
      : String(Constants.nativeBuildVersion ?? androidCode ?? '1');
  const release = `com.hungertap.app@${version}+${dist}`;
  return { release, dist };
}

/**
 * Initialize Sentry as early as possible on the JS thread.
 * Native layer is started earlier via RNSentrySDK.init in MainApplication
 * (useNativeInit / sentry.options.json) when using a Dev Client / release build.
 */
export function initSentry() {
  if (global.__HUNGERTAP_SENTRY_INIT__) {
    return Sentry;
  }

  // Same DSN as sentry.options.json / app.config.js fallback — required for native↔JS alignment
  const dsn =
    process.env.EXPO_PUBLIC_SENTRY_DSN ||
    Constants.expoConfig?.extra?.sentryDsn ||
    'https://bb60d6a835d37cb605b3912fc132c486@o4511688461975552.ingest.us.sentry.io/4511688470560768';

  const { release, dist } = getSentryReleaseDist();
  const environment =
    process.env.SENTRY_ENVIRONMENT ||
    process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ||
    (__DEV__ ? 'development' : 'production');

  // Expo Go has no native Sentry binary — JS-only capture is limited and startup/native crashes cannot be reported.
  const enabled = Boolean(dsn) && !isExpoGo;

  Sentry.init({
    dsn: dsn || undefined,
    enabled,
    debug: typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_SENTRY_DEBUG === 'true',
    environment,
    release,
    dist,
    enableNative: !isExpoGo,
    enableNativeCrashHandling: true,
    enableAutoSessionTracking: true,
    // Android ANR + iOS watchdog / app hang detection (SDK 8.x)
    enableAppHangTracking: true,
    tracesSampleRate: __DEV__ ? 0.0 : 0.2,
    sendDefaultPii: false,
    ignoreErrors: [],
  });

  Sentry.setTag('expo_go', String(isExpoGo));
  Sentry.setTag('hermes', String(!!global.HermesInternal));
  Sentry.setTag('app_ownership', String(Constants.appOwnership || 'unknown'));

  global.__HUNGERTAP_SENTRY_INIT__ = true;

  if (!dsn) {
    console.warn(
      '[Sentry] EXPO_PUBLIC_SENTRY_DSN is missing — crash reporting is disabled. Set it in .env and sentry.options.json.'
    );
  }
  // Expo Go: Sentry stays disabled above (no native binary). Native crash reporting
  // requires a development build (`npm run start:dev`) or release APK — no WARN needed.

  return Sentry;
}

export { Sentry };
