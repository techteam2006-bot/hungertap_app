// App Configuration
// **Do not commit real Supabase keys in source.** Set EXPO_PUBLIC_SUPABASE_URL and
// EXPO_PUBLIC_SUPABASE_ANON_KEY in .env (see .env.example). The anon key is not a
// private server secret, but it still must not be hardcoded: it names your project
// and allows API use within RLS; rotate if it ever leaks.

// Expo injects EXPO_PUBLIC_* from .env — single source (no duplicate SUPABASE_* in .env).
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const DEV_IP = process.env.DEV_IP || '20.20.4.87';
const DEEP_LINK_PORT = process.env.DEEP_LINK_PORT || '8083';

function envTruth(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * When false (default), checkout uses Supabase `create_order_minimal` in the app (no local server).
 * Set EXPO_PUBLIC_USE_ORDER_HTTP=true only if you run backend order API + worker (POST /order).
 */
const ORDER_HTTP_ENABLED = envTruth(process.env.EXPO_PUBLIC_USE_ORDER_HTTP);

/** Local/custom order API (POST /order). Override with full base URL, e.g. EXPO_PUBLIC_ORDER_API_BASE=http://192.168.1.5:3000 */
const ORDER_API_BASE = (process.env.EXPO_PUBLIC_ORDER_API_BASE || `http://${DEV_IP}:3000`).replace(
  /\/$/,
  ''
);

/** GET menu JSON when `EXPO_PUBLIC_MENU_FROM_HTTP` is true; defaults to `{ORDER_API_BASE}/api/menu`. */
const MENU_HTTP_URL = (process.env.EXPO_PUBLIC_MENU_HTTP_URL || `${ORDER_API_BASE}/api/menu`).replace(
  /\/$/,
  ''
);

/** Paid checkout: Edge Function creates order + Easebuzz session (webhook updates DB). */
const CREATE_ORDER_V2_URL_RAW = (
  process.env.EXPO_PUBLIC_CREATE_ORDER_V2_URL || ''
).trim();
const CREATE_ORDER_V2_URL = CREATE_ORDER_V2_URL_RAW
  ? CREATE_ORDER_V2_URL_RAW.replace(/\/$/, '')
  : SUPABASE_URL
    ? `${String(SUPABASE_URL).replace(/\/$/, '')}/functions/v1/create-order-v2`
    : '';

/** Cart: `local` = device-only (AsyncStorage), no `cart_items` table. `remote` = Supabase `cart_items`. */
const CART_STORAGE = process.env.EXPO_PUBLIC_CART_STORAGE || 'local';

if (typeof __DEV__ !== 'undefined' && __DEV__ && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
  // eslint-disable-next-line no-console
  console.warn(
    '[HungerTap] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and add values from the Supabase dashboard.'
  );
}

export const CONFIG = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,

  CART_STORAGE,

  ORDER_API_BASE,
  ORDER_HTTP_ENABLED,
  MENU_HTTP_URL,

  /** POST with user JWT — returns final Easebuzz checkout payment_url (+ order_id, payment_id). */
  CREATE_ORDER_V2_URL,

  // Deep Linking Configuration
  DEEP_LINK_PREFIX: `exp://${DEV_IP}`,
  
  // Auth Redirect URLs
  AUTH_REDIRECT_URLS: [
    `exp://${DEV_IP}:${DEEP_LINK_PORT}/--/complete-profile`,
    `exp://${DEV_IP}:${DEEP_LINK_PORT}/--/main`,
    `exp://${DEV_IP}:${DEEP_LINK_PORT}/--/login`,
    `exp://${DEV_IP}:${DEEP_LINK_PORT}/--/signup`,
  ],
  
  // Magic Link Redirect URL
  MAGIC_LINK_REDIRECT: `exp://${DEV_IP}/--/login`,
};

// Helper function to get current IP (for development)
export const getCurrentIP = () => {
  // Get from env or use default
  return DEV_IP;
};

// Helper function to update all URLs with new IP
export const updateURLsWithIP = (newIP) => {
  return {
    ...CONFIG,
    DEEP_LINK_PREFIX: `exp://${newIP}:8082`,
    AUTH_REDIRECT_URLS: [
      `exp://${newIP}:8082/--/complete-profile`,
      `exp://${newIP}:8082/--/main`,
      `exp://${newIP}:8082/--/login`,
      `exp://${newIP}:8082/--/signup`,
    ],
    MAGIC_LINK_REDIRECT: `exp://${newIP}:8082/--/login`,
  };
};

// Helper function to update Supabase configuration
export const updateSupabaseConfig = (newUrl, newKey) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('🔄 Updating Supabase configuration...');
    console.log('🌐 New URL:', newUrl);
    console.log('🔑 New Key length:', newKey?.length || 0);
  }
  
  // This function helps users update their Supabase configuration
  return {
    message: 'Update Supabase credentials in .env (EXPO_PUBLIC_SUPABASE_*) or config.js defaults:',
    url: newUrl,
    key: newKey,
    instructions: [
      '1. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env',
      '2. Restart Expo',
    ]
  };
}; 