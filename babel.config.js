module.exports = function(api) {
  api.cache(true);
  const isProduction = process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production';
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Strip all console.* calls in production to reduce bundle size
      ...(isProduction ? [['transform-remove-console', { exclude: ['error', 'warn'] }]] : []),
    ],
  };
};