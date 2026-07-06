const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Never bundle git metadata if Metro walks the project tree
config.resolver.blockList = [/\/\.git\//];

// Add support for additional file extensions
config.resolver.assetExts.push('db', 'mp3', 'ttf', 'obj', 'png', 'jpg', 'webp');

// Stub out web-only packages on native to prevent them from entering the bundle
// even if they are still present in node_modules
const emptyModule = path.resolve(__dirname, 'lib/emptyModule.js');
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
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

