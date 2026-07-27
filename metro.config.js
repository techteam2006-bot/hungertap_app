const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

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
// even if they are still present in node_modules
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
  }
  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
