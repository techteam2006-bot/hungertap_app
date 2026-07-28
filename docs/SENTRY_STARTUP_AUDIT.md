# Sentry Startup Crash Reporting — Audit Report

**Date:** 2026-07-27  
**App:** HungerTap (`com.hungertap.app`) — Expo SDK 54 / RN 0.81 / Hermes  
**Sentry SDK:** `@sentry/react-native@8.20.0`

---

## Current Integration (before → after)

### What was wrong (root cause of missing startup crashes)

| Finding | Detail |
| :--- | :--- |
| **No JS Sentry SDK** | `package.json` had **no** `@sentry/react-native` / `sentry-expo`. Only a leftover `android/sentry.properties` (org `trovox`, project `android`). |
| **No `Sentry.init()`** | Nothing initialized Sentry in JS. Any “JS crashes in Sentry” were not coming from this repo’s code path (or were from another build). |
| **Late / missing entry** | Entry was `node_modules/expo/AppEntry.js` → `App.js`. `App.js` imported screens, Auth, Supabase, notifications, etc. **before** any error tooling ran. |
| **No native startup init** | `MainApplication.onCreate` never called `RNSentrySDK.init()`. Native crashes before the RN bridge could not be reported. |
| **No Expo Sentry plugin** | No source-map upload wiring, no `useNativeInit`. |
| **Expo Go limitation** | Even with the SDK, Expo Go **cannot** ship the native Sentry binary → startup/native/ANR crashes will never appear there. |
| **Custom handlers** | `installGlobalErrorSafety` + `AppErrorBoundary` only `console.error`’d — they did not forward to Sentry (and could mask awareness of unreported fatals). |

### What is configured correctly now

- Earliest JS init in `index.js` **before** `require('./App')` (avoids ES import hoisting).
- Native init in `MainApplication` via `RNSentrySDK.init(this)` reading `assets/sentry.options.json`.
- Expo plugin `@sentry/react-native/expo` with `useNativeInit: true`.
- Metro via `getSentryExpoConfig` (Debug IDs / source maps).
- Release/dist aligned: `com.hungertap.app@{version}+{versionCode}`.
- ProGuard keep rules for `io.sentry.**`.
- ErrorUtils + ErrorBoundary forward to `Sentry.captureException`.
- Temporary crash probes gated by `EXPO_PUBLIC_SENTRY_CRASH_TEST`.

### What still blocks reporting until you configure secrets

1. Set **`EXPO_PUBLIC_SENTRY_DSN`** in `.env` **and** the same value in **`sentry.options.json`** + **`android/app/src/main/assets/sentry.options.json`**.
2. Set **`SENTRY_AUTH_TOKEN`** as an EAS secret (sensitive) so release builds upload source maps / mappings.
3. Rebuild a **development client or release APK** (not Expo Go).
4. Keep `release` / `dist` in `sentry.options.json` matching `app.json` `version` + `android.versionCode` (or set `SENTRY_RELEASE` / `SENTRY_DIST` at build time).

---

## Files Modified

| File | Change |
| :--- | :--- |
| `package.json` | Added `@sentry/react-native`; `main` → `index.js` |
| `index.js` | **New** entry: init Sentry, then load App; crash probes A/B/C |
| `lib/sentry.js` | **New** early `Sentry.init` (native crash, ANR hang, release/dist) |
| `lib/installGlobalErrorSafety.js` | Forwards fatals to Sentry, then previous handler |
| `components/AppErrorBoundary.js` | `captureException` in `componentDidCatch` |
| `App.js` | Crash probe D (`js-fatal`) after mount |
| `app.config.js` | **New** Expo config + Sentry plugin (`useNativeInit`) |
| `metro.config.js` | `getSentryExpoConfig` |
| `eas.json` | `SENTRY_ENVIRONMENT` / release env for builds |
| `sentry.options.json` | **New** native options file (fill DSN) |
| `android/app/src/main/assets/sentry.options.json` | Copy for native runtime |
| `android/.../MainApplication.kt` | `RNSentrySDK.init(this)` before SoLoader |
| `android/app/proguard-rules.pro` | Keep Sentry for R8 |
| `.env.example` | Document Sentry env vars |
| `docs/SENTRY_STARTUP_AUDIT.md` | This report |

---

## Reason for Each Change

1. **Install `@sentry/react-native`** — actual SDK (JS + native). Previously missing.
2. **`index.js` + `main`** — JS init before App module graph (providers, Supabase, splash, fonts).
3. **`RNSentrySDK.init` + `sentry.options.json`** — capture crashes **before** the JS bundle runs.
4. **Expo plugin + Metro Sentry config** — EAS source maps / Debug IDs; `useNativeInit` for future prebuilds.
5. **Release/dist alignment** — symbolication and release health stay consistent across pre-JS and post-JS events.
6. **ProGuard keeps** — R8 minify (`enableMinifyInReleaseBuilds: true`) must not strip Sentry.
7. **Handler / boundary forwarding** — do not swallow errors before Sentry sees them.
8. **Crash probes** — verify A–D without rewriting product flows (disable via env).

---

## Expo Go vs Development / Production Build

| Runtime | JS errors after launch | Startup / native / ANR |
| :--- | :--- | :--- |
| **Expo Go** | Limited / often none (no native SDK) | **Not supported** |
| **Dev Client / `expo run:android`** | Yes | Yes (with DSN + rebuild) |
| **Release APK/AAB** | Yes | Yes (with DSN + `SENTRY_AUTH_TOKEN` for maps) |

**Why Expo Go fails:** Go embeds a fixed native binary without your Sentry native module. `enableNative` is forced off; `RNSentrySDK` / `nativeCrash` are unavailable.

---

## Hermes

Hermes is enabled (`android/gradle.properties` → `hermesEnabled=true`). Sentry RN 8.x supports Hermes. Source maps / Debug IDs via `getSentryExpoConfig` are required for readable stacks. Tag `hermes=true` is set at init.

---

## Testing (step-by-step)

### Prerequisites

1. Create/open Sentry project (org `trovox` / project `android` or your real project).
2. Copy Client Key (DSN) into:
   - `.env` → `EXPO_PUBLIC_SENTRY_DSN=...`
   - `sentry.options.json` → `"dsn": "..."`
   - `android/app/src/main/assets/sentry.options.json` → same
3. EAS: `eas secret:create --name SENTRY_AUTH_TOKEN --value <token> --type string` (sensitive).
4. Rebuild: `npx expo run:android` or EAS `apk` / `production` profile. **Not Expo Go.**

### A — Immediately after `Sentry.init`

```bash
# .env
EXPO_PUBLIC_SENTRY_CRASH_TEST=after-init
```

Cold-start app → process dies before UI → event in Sentry (JS, pre-React).

### B — Before React render

```bash
EXPO_PUBLIC_SENTRY_CRASH_TEST=before-render
```

Cold-start → crash before `registerRootComponent` → Sentry event.

### C — Native Android crash

```bash
EXPO_PUBLIC_SENTRY_CRASH_TEST=native
```

Cold-start on **device/emulator with Dev Client/release** → native fatal via `Sentry.nativeCrash()` → native issue in Sentry (may need ~1–2 min).

### D — JS fatal after mount

```bash
EXPO_PUBLIC_SENTRY_CRASH_TEST=js-fatal
```

App begins mounting → throw in `App` `useEffect` → JS event (and/or ErrorBoundary capture).

### After verification

Remove or unset `EXPO_PUBLIC_SENTRY_CRASH_TEST`.

### ANR (Android)

Harder to automate: block main thread > ~5s on a release build (e.g. temporary `while(true){}` on UI thread). With native SDK + ANR enabled, Sentry should show an ANR issue. Prefer a short-lived debug build for this.

### Launch failures / pre-JS native

Corrupt/remove JS bundle or throw in `MainApplication` after `RNSentrySDK.init` — native event should still flush if DSN in assets options is valid.

---

## Expected Result

With DSN filled, Dev Client/release rebuild, and crash probes cleared:

| When | Captured? |
| :--- | :--- |
| Before first screen (native / pre-JS) | Yes (`RNSentrySDK` + `sentry.options.json`) |
| During JS init / module load / providers | Yes (`index.js` init before `App`) |
| Splash / fonts / auth / Supabase after JS load | Yes (Sentry ErrorUtils + boundary) |
| After app launch | Yes |
| Expo Go startup/native | **No** — use Dev Client / production build |

---

## Checklist for you

- [ ] Paste real DSN into `.env` + both `sentry.options.json` files  
- [ ] Add `SENTRY_AUTH_TOKEN` to EAS  
- [ ] Rebuild native app  
- [ ] Run probes A→D once each  
- [ ] Unset `EXPO_PUBLIC_SENTRY_CRASH_TEST`  
- [ ] Confirm Issues in Sentry show matching `release` = `com.hungertap.app@1.0.0+1` (update when versionCode changes)
