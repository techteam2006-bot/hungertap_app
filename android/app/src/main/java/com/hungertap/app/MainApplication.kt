package com.hungertap.app

import android.app.Application
import android.content.res.Configuration
import android.util.Log

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

import io.sentry.react.RNSentrySDK

/**
 * Application entry — Sentry is initialized on the native layer BEFORE SoLoader /
 * React Native host setup so startup / pre-JS crashes are reported.
 *
 * Docs: https://docs.sentry.io/platforms/react-native/manual-setup/app-start-error-capture/
 */
class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
        this,
        object : DefaultReactNativeHost(this) {
          override fun getPackages(): List<ReactPackage> {
            val packages = PackageList(this).packages.toMutableList()
            // Manual package: Android ANR test helper for DEV SentryDebugScreen
            packages.add(HungerTapSentryDebugPackage())
            return packages
          }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
          override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    // 1) Required Application lifecycle
    super.onCreate()

    // 2) Native Sentry — reads android/app/src/main/assets/sentry.options.json
    //    (copied from project-root sentry.options.json at build / prebuild).
    //    Must run before SoLoader / RN so crashes during native + JS bundle load are captured.
    RNSentrySDK.init(this)
    Log.i(TAG, "Sentry native init complete (RNSentrySDK.init)")

    // ── STARTUP CRASH TEST (DISABLED BY DEFAULT) ─────────────────────────────
    // Enable ONLY for a one-off release/dev-client test of pre-JS crash capture:
    //   1. Set HUNGERTAP_SENTRY_STARTUP_CRASH = true below
    //   2. Rebuild the native APK (assembleRelease / EAS)
    //   3. Launch once — app dies after Sentry init, before RN bridge / JS
    //   4. Relaunch (Sentry flushes on next start) and check Issues in Sentry
    //   5. Set the flag back to false and rebuild
    //
    // Why this location works:
    //   - RNSentrySDK.init(this) has already run → DSN + crash handler active
    //   - SoLoader.init / React Native host have NOT run yet → no JS runtime
    //
    // Do NOT leave enabled in production builds.
    val HUNGERTAP_SENTRY_STARTUP_CRASH = false
    if (HUNGERTAP_SENTRY_STARTUP_CRASH) {
      Log.e(TAG, "HUNGERTAP_SENTRY_STARTUP_CRASH enabled — throwing after native Sentry init, before RN")
      throw RuntimeException(
        "[SentryStartupCrash] Intentional crash after RNSentrySDK.init, before SoLoader/RN"
      )
    }
    // ── END STARTUP CRASH TEST ───────────────────────────────────────────────

    // 3) React Native / Expo native bootstrap (JS bridge starts after this path)
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }

  companion object {
    private const val TAG = "HungerTapSentry"
  }
}
