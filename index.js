/**
 * Application entry — Sentry MUST initialize before App.js (and its heavy imports) load.
 * Uses require() after init so Metro does not hoist App module evaluation before Sentry.init().
 */
import 'react-native-gesture-handler';
import { LogBox } from 'react-native';
import { initSentry, Sentry } from './lib/sentry';

initSentry();

// Expected offline / Expo Go noise — do not cover login with red LogBox toasts.
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  LogBox.ignoreLogs([
    'Network request failed',
    'TypeError: Network request failed',
    'expo-notifications',
    'Android Push notifications',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ]);
}

// Temporary crash probes — only when EXPO_PUBLIC_SENTRY_CRASH_TEST is set.
// Values: after-init | before-render | native | js-fatal
const crashTest = process.env.EXPO_PUBLIC_SENTRY_CRASH_TEST;

if (crashTest === 'after-init') {
  // A) Immediately after Sentry initialization (JS, pre-React)
  throw new Error('[SentryCrashTest] A: crash immediately after Sentry.init()');
}

if (crashTest === 'before-render') {
  // B) Before React renders (still pre-registerRootComponent)
  throw new Error('[SentryCrashTest] B: crash before React render / registerRootComponent');
}

if (crashTest === 'native') {
  // C) Native Android/iOS fatal — requires Dev Client / release (not Expo Go)
  try {
    Sentry.nativeCrash();
  } catch (e) {
    throw new Error(
      `[SentryCrashTest] C: nativeCrash unavailable (${e?.message || e}). Use a native build.`
    );
  }
}

const { registerRootComponent } = require('expo');
const App = require('./App').default;

registerRootComponent(Sentry.wrap(App));
