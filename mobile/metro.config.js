const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
// Matroska is not in Metro's default video asset extensions.
config.resolver.assetExts.push('mkv');

module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
