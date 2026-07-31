package com.hungertap.app

import android.os.Handler
import android.os.Looper
import android.util.Log

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Debug-only helpers for Sentry validation (invoked from SentryDebugScreen in __DEV__).
 * ANR detection requires blocking the Android main (UI) thread — a JS busy-loop is not enough.
 */
class HungerTapSentryDebugModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "HungerTapSentryDebug"

  /**
   * Posts a long sleep on the main looper so Sentry's Android ANR integration can fire.
   * Default sleep is 8 seconds (above typical ANR thresholds).
   */
  @ReactMethod
  fun triggerAnr(durationMs: Double) {
    val sleepMs = if (durationMs > 0) durationMs.toLong() else 8_000L
    Log.e(TAG, "ANR Test — scheduling main-thread sleep for ${sleepMs}ms")
    Handler(Looper.getMainLooper()).post {
      Log.e(TAG, "ANR Test — main thread blocked NOW")
      try {
        Thread.sleep(sleepMs)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
      Log.e(TAG, "ANR Test — main thread unblocked")
    }
  }

  companion object {
    private const val TAG = "HungerTapSentry"
  }
}
