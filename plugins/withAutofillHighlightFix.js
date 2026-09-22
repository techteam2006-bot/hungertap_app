/**
 * Android autofill paints a yellow-green overlay unless the activity theme sets
 * `android:autofilledHighlight` to a transparent *drawable* (not a color).
 * Keeps the drawable + theme item across `expo prebuild`.
 */
const {
  AndroidConfig,
  withAndroidStyles,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DRAWABLE_NAME = 'autofill_highlight';
const DRAWABLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
  <solid android:color="@android:color/transparent" />
</shape>
`;

function ensureAutofillHighlightItem(items = []) {
  const next = Array.isArray(items) ? [...items] : [];
  const idx = next.findIndex(
    (item) => item?.$?.name === 'android:autofilledHighlight'
  );
  const entry = {
    $: { name: 'android:autofilledHighlight', 'tools:targetApi': '26' },
    _: `@drawable/${DRAWABLE_NAME}`,
  };
  if (idx >= 0) next[idx] = entry;
  else next.push(entry);
  return next;
}

function withAutofillHighlightFix(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const drawableDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'drawable'
      );
      fs.mkdirSync(drawableDir, { recursive: true });
      fs.writeFileSync(
        path.join(drawableDir, `${DRAWABLE_NAME}.xml`),
        DRAWABLE_XML,
        'utf8'
      );
      return cfg;
    },
  ]);

  config = withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults;
    if (!styles?.resources) return cfg;

    if (!styles.resources.$) styles.resources.$ = {};
    styles.resources.$['xmlns:tools'] =
      styles.resources.$['xmlns:tools'] ||
      'http://schemas.android.com/tools';

    const styleList = Array.isArray(styles.resources.style)
      ? styles.resources.style
      : styles.resources.style
        ? [styles.resources.style]
        : [];

    for (const style of styleList) {
      if (!style?.$?.name) continue;
      if (style.$.name !== 'AppTheme' && style.$.name !== 'Theme.App.SplashScreen') {
        continue;
      }
      style.item = ensureAutofillHighlightItem(style.item);
    }

    styles.resources.style = styleList;
    cfg.modResults = styles;
    return cfg;
  });

  return config;
}

module.exports = withAutofillHighlightFix;
