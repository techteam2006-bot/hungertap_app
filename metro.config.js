const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Never bundle git metadata if Metro walks the project tree
config.resolver.blockList = [/\/\.git\//];

// Add support for additional file extensions
config.resolver.assetExts.push('db', 'mp3', 'ttf', 'obj', 'png', 'jpg', 'webp');

module.exports = config;

