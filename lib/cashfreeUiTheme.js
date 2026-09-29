/**
 * Design tokens for the HungerTap × Cashfree payment UI
 * (components/cashfree/CashfreeCheckoutSheet.js).
 *
 * Change a colour here and it changes everywhere in the in-app payment
 * screens AND in the Cashfree drop-in checkout theme (lib/cashfreeCheckout.js).
 */
import { appTypography } from './darkThemeConfig';

/**
 * true  → Cashfree payments use the custom HungerTap UI (UPI apps, card form,
 *         processing / failed screens) built on Cashfree's Element SDK calls.
 * false → old behaviour: open Cashfree's own drop-in checkout straight away.
 *
 * Flip this if the custom UI ever misbehaves in production.
 */
export const USE_CUSTOM_CASHFREE_UI = true;

export const cfColors = {
  // Brand accent — HungerTap gold (matches lib/darkThemeConfig.js brandYellow)
  brand: '#f5bc3b',
  brandDark: '#d4a017',
  brandDeep: '#8b6914',
  brandLight: '#fff3c4',
  brand50: '#fffbeb',
  /** Text/icons on a solid brand-yellow surface (white fails contrast on yellow). */
  onBrand: '#1f1502',

  // Neutrals
  ink900: '#0f172a',
  ink800: '#1e293b',
  ink700: '#334155',
  ink500: '#64748b',
  ink400: '#94a3b8',
  ink200: '#e2e8f0',
  ink100: '#f1f5f9',
  ink50: '#f8fafc',

  // Status
  success: '#16a34a',
  successBg: '#ecfdf3',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  warning: '#d97706',
  warningBg: '#fffbeb',

  white: '#ffffff',
  cashfree: '#1a2b4c',
  cashfreeGreen: '#11a75c',
};

export const cfRadius = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
};

/** Payment screens use the app's own font (Afacad) instead of the demo's Inter. */
export const cfFonts = {
  regular: appTypography.regular,
  medium: appTypography.medium,
  semiBold: appTypography.semiBold,
  bold: appTypography.bold,
};

/** Tile colours/labels for known UPI apps (Android package → look). */
export const UPI_APP_LOOKS = {
  'com.google.android.apps.nbu.paisa.user': { label: 'GPay', short: 'G', color: '#4285f4' },
  'com.phonepe.app': { label: 'PhonePe', short: 'Pe', color: '#5f259f' },
  'net.one97.paytm': { label: 'Paytm', short: 'Pm', color: '#00baf2' },
  'in.org.npci.upiapp': { label: 'BHIM', short: 'B', color: '#e5720e' },
  'com.dreamplug.androidapp': { label: 'CRED', short: 'C', color: '#111827' },
  'in.amazon.mShop.android.shopping': { label: 'Amazon Pay', short: 'A', color: '#f59e0b' },
  'com.mobikwik_new': { label: 'MobiKwik', short: 'M', color: '#1e40af' },
  'com.freecharge.android': { label: 'Freecharge', short: 'F', color: '#ea580c' },
};

/** Theme handed to Cashfree's own drop-in checkout (Wallets). */
export const cfDropInTheme = {
  navigationBarBackgroundColor: cfColors.brand,
  navigationBarTextColor: cfColors.onBrand,
  buttonBackgroundColor: cfColors.brand,
  buttonTextColor: cfColors.onBrand,
  primaryTextColor: cfColors.ink900,
  secondaryTextColor: cfColors.ink500,
  backgroundColor: '#FFFFFF',
};

/**
 * Net banking — Cashfree bank codes (cashfree.com/docs/payments/manage/payment-methods/netbanking).
 * `quick` banks show as tiles; the rest appear in "Or choose another bank".
 */
export const NETBANKING_BANKS = [
  { code: 3044, name: 'State Bank of India', short: 'SBI', color: '#004c8f', quick: true },
  { code: 3021, name: 'HDFC Bank', short: 'HDFC', color: '#004b8d', quick: true },
  { code: 3022, name: 'ICICI Bank', short: 'ICICI', color: '#f37021', quick: true },
  { code: 3003, name: 'Axis Bank', short: 'Axis', color: '#97144d', quick: true },
  { code: 3038, name: 'Punjab National Bank' },
  { code: 3005, name: 'Bank of Baroda' },
  { code: 3032, name: 'Kotak Mahindra Bank' },
  { code: 3024, name: 'IDFC FIRST Bank' },
  { code: 3009, name: 'Canara Bank' },
  { code: 3055, name: 'Union Bank of India' },
  { code: 3006, name: 'Bank of India' },
  { code: 3026, name: 'Indian Bank' },
  { code: 3058, name: 'Yes Bank' },
  { code: 3028, name: 'IndusInd Bank' },
  { code: 3020, name: 'Federal Bank' },
];

/** Wallet tiles. Cashfree's RN SDK has no direct wallet call, so a tap opens Cashfree's wallet page. */
export const WALLETS = [
  { id: 'paytm', label: 'Paytm', short: 'Pm', color: '#00baf2' },
  { id: 'amazon', label: 'Amazon Pay', short: 'Az', color: '#ff9900' },
  { id: 'mobikwik', label: 'Mobikwik', short: 'Mo', color: '#3f51b5' },
  { id: 'freecharge', label: 'Freecharge', short: 'Fc', color: '#f5bc3b', textColor: '#1f1502' },
];
