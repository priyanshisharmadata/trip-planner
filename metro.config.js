const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Keep native bundling within this machine's memory budget alongside Gradle.
config.maxWorkers = 1;
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  /[\\/]\.tools[\\/].*/,
  /[\\/]dist-native[\\/].*/,
  /[\\/]artifacts[\\/].*/,
];

module.exports = config;
