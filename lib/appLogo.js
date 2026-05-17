/** HungerTap brand mark — replace `assets/logo.png` to rebrand the app. */
export const APP_LOGO = require('../assets/logo.png');

/**
 * Menu / cart / search — when an item has no usable image URL.
 * Uses the same bundled asset as global loading (missing `HungerTap-Transparent-removebg-preview.png`).
 */
export const ITEM_IMAGE_FALLBACK = require('../assets/hungertap-global-loading.png');

/** Full wordmark + mascot for the login screen only (`assets/login-logo.png`). */
export const LOGIN_SCREEN_LOGO = require('../assets/login-logo-transparent.png');

/** Cat mascot — used on splash, global loading, home holding state, and native splash. */
const loadingMascot = require('../assets/hungertap-global-loading.png');
export const LOADING_MASCOT = loadingMascot;
export const SPLASH_SCREEN_LOGO = loadingMascot;

/** Loading / legacy wordmark — was Loading-Logo*.png; use bundled global loading art */
const hungerTapGlobalLoading = require('../assets/hungertap-global-loading.png');
export const LOADING_SCREEN_LOGO = hungerTapGlobalLoading;
export const WHITE_BG_LOGO = hungerTapGlobalLoading;

/** App-wide loading overlay (`App.js` GlobalLoading) — same mascot as splash */
export const GLOBAL_LOADING_LOGO = loadingMascot;

/** Canteen status check + kitchen closed UI — same bundled art as global loading */
export const CANTEEN_STATUS_LOGO = hungerTapGlobalLoading;

/** Home menu list empty state (no items in category / search) */
export const NO_ITEMS_EMPTY_ILLUSTRATION = require('../assets/no-items-empty-state.png');
