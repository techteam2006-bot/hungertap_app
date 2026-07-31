/** HungerTap brand mark — single bundled logo for splash, login, loading, and fallbacks. */
const appLogo = require('../assets/logo1.png');
/** HC mark on white — post-auth / branded loading screen */
const authLoadingLogo = require('../assets/icon1.png');

export const APP_LOGO = appLogo;

/**
 * Menu / cart / search — when an item has no usable image URL.
 */
export const ITEM_IMAGE_FALLBACK = appLogo;

/** Full wordmark + mascot for the login screen. */
export const LOGIN_SCREEN_LOGO = appLogo;

/** Cat mascot — used on splash, global loading, home holding state, and native splash. */
export const LOADING_MASCOT = appLogo;
export const SPLASH_SCREEN_LOGO = appLogo;

/** Loading / legacy wordmark */
export const LOADING_SCREEN_LOGO = appLogo;
export const WHITE_BG_LOGO = appLogo;

/** App-wide loading overlay (`App.js` GlobalLoading) */
export const GLOBAL_LOADING_LOGO = appLogo;

/** Post login/signup branded loading screen (light) */
export const AUTH_LOADING_LOGO = authLoadingLogo;

/** Canteen status check + kitchen closed UI */
export const CANTEEN_STATUS_LOGO = appLogo;
