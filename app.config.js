/**
 * Expo app config (replaces static app.json for Sentry DSN / plugin injection).
 * Values mirror the previous app.json; Sentry plugin enables native init + source map upload on EAS.
 */
const appJson = require('./app.json');

const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN || '';
const version = appJson.expo.version || '1.0.0';
const versionCode = appJson.expo.android?.versionCode ?? 1;
const release = `com.hungertap.app@${version}+${versionCode}`;
const dist = String(versionCode);

module.exports = {
  ...appJson.expo,
  plugins: [
    ...(appJson.expo.plugins || []),
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG || 'trovox',
        project: process.env.SENTRY_PROJECT || 'android',
        url: 'https://sentry.io/',
        // Native SDK starts in MainApplication before JS — required for startup crashes
        useNativeInit: true,
        options: {
          dsn: sentryDsn,
          environment: process.env.SENTRY_ENVIRONMENT || 'production',
          release,
          dist,
          tracesSampleRate: 0.2,
          enableAutoSessionTracking: true,
        },
      },
    ],
  ],
  extra: {
    ...(appJson.expo.extra || {}),
    sentryDsn,
    sentryRelease: release,
    sentryDist: dist,
  },
};
