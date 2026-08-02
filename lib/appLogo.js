/** Full brand mark (logo.png) — splash, login, loaders, fallbacks. */
const appLogo = require('../assets/logo.png');
/** Compact app icon (icon.png) — launcher / adaptive icon asset. */
const appIcon = require('../assets/icon.png');

export const APP_LOGO = appLogo;
export const APP_ICON = appIcon;

/**
 * Menu / cart / search — when an item has no usable image URL.
 */
export const ITEM_IMAGE_FALLBACK = appLogo;

/** Full wordmark + mascot for the login screen. */
export const LOGIN_SCREEN_LOGO = appLogo;

/** Used on splash, global loading, home holding state. */
export const LOADING_MASCOT = appIcon;
export const SPLASH_SCREEN_LOGO = appIcon;

/** Loading / legacy wordmark */
export const LOADING_SCREEN_LOGO = appIcon;
export const WHITE_BG_LOGO = appLogo;

/** App-wide loading overlay (`App.js` GlobalLoading) */
export const GLOBAL_LOADING_LOGO = appIcon;

/** Post login/signup branded loading screen */
export const AUTH_LOADING_LOGO = appIcon;

/** Canteen status check + kitchen closed UI */
export const CANTEEN_STATUS_LOGO = appLogo;
