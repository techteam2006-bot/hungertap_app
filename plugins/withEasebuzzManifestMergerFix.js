/**
 * Easebuzz SDK sets enableOnBackInvokedCallback=true; Expo sets false — merge conflict on release builds.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

function withEasebuzzManifestMergerFix(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    if (!manifest.manifest.$) {
      manifest.manifest.$ = {};
    }
    manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const application = manifest.manifest.application?.[0];
    if (!application) return cfg;

    if (!application.$) application.$ = {};
    application.$['android:enableOnBackInvokedCallback'] = 'false';
    application.$['tools:replace'] = 'android:enableOnBackInvokedCallback';

    return cfg;
  });
}

module.exports = withEasebuzzManifestMergerFix;
