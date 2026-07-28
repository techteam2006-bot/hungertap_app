const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');
const fs = require('fs');

// Sentry Metro config enables Debug ID / source map metadata for release symbolication
const config = getSentryExpoConfig(__dirname);

/**
 * @sentry/browser (and some other @sentry/* pkgs) expose a `react-native` export that
 * points at ESM. Metro then fails to resolve sibling files like `./stack-parsers.js`
 * (UnableToResolveError) — common on Windows with package exports.
 * Force the CJS builds instead.
 */
const SENTRY_CJS_ENTRY = {
  '@sentry/browser': path.join(
    __dirname,
    'node_modules',
    '@sentry',
    'browser',
    'build',
    'npm',
    'cjs',
    'prod',
    'index.js'
  ),
  '@sentry/react': path.join(
    __dirname,
    'node_modules',
    '@sentry',
    'react',
    'build',
    'cjs',
    'index.js'
  ),
  '@sentry/core': path.join(
    __dirname,
    'node_modules',
    '@sentry',
    'core',
    'build',
    'cjs',
    'index.js'
  ),
};

function resolveIfExists(filePath) {
  return fs.existsSync(filePath) ? { type: 'sourceFile', filePath } : null;
}

// Prefer require/CJS conditions when package exports are evaluated
config.resolver.unstable_conditionNames = ['require', 'react-native', 'default'];
config.resolver.unstable_conditionsByPlatform = {
  ...(config.resolver.unstable_conditionsByPlatform || {}),
  android: ['require', 'react-native', 'default'],
  ios: ['require', 'react-native', 'default'],
};

// Never bundle git metadata if Metro walks the project tree
config.resolver.blockList = [
  /\/\.git\//,
  // Prefer .js auth components over any leftover .tsx of the same name
  /components[\\/](SignupForm|OTPInput|CountdownTimer|EmailVerificationSection)\.tsx$/,
];

// Prefer JS over TS when both exist (native/dev-client + Expo Go stay in sync)
const defaultSourceExts = config.resolver.sourceExts || [];
config.resolver.sourceExts = [
  ...defaultSourceExts.filter((ext) => ext === 'js' || ext === 'jsx'),
  ...defaultSourceExts.filter((ext) => ext !== 'js' && ext !== 'jsx'),
];

// Add support for additional file extensions
config.resolver.assetExts.push('db', 'mp3', 'ttf', 'obj', 'png', 'jpg', 'webp');

// Stub out web-only packages on native to prevent them from entering the bundle
const emptyModule = path.resolve(__dirname, 'lib/emptyModule.js');
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web') {
    if (
      moduleName === 'react-native-web' ||
      moduleName === 'react-dom' ||
      moduleName === 'react-dom/client' ||
      moduleName.startsWith('react-dom/')
    ) {
      return { type: 'sourceFile', filePath: emptyModule };
    }

    const sentryCjs = SENTRY_CJS_ENTRY[moduleName];
    if (sentryCjs) {
      const hit = resolveIfExists(sentryCjs);
      if (hit) return hit;
    }

    // Subpath: @sentry/core/browser → CJS browser entry when present
    if (moduleName === '@sentry/core/browser') {
      const cjsBrowser = path.join(
        __dirname,
        'node_modules',
        '@sentry',
        'core',
        'build',
        'cjs',
        'browser.js'
      );
      const hit = resolveIfExists(cjsBrowser);
      if (hit) return hit;
    }
  }

  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
