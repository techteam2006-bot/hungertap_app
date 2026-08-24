# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-webview (payment flow)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keep class com.reactnativecommunity.webview.** { *; }

# Hermes JS engine
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# Sentry — keep native crash / ANR / NDK hooks when R8 minify is on
-keepattributes SourceFile,LineNumberTable
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**

# Expo modules
-keep class expo.modules.** { *; }

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Payment gateway native SDKs — reached reflectively / via WebView JS bridges,
# so R8 must not rename or strip them in release builds.
-keep class com.reactnativecashfreepgsdk.** { *; }
-keep class com.cashfree.** { *; }
-keep class com.cashfree.pg.** { *; }
-keep class com.cashfree.pg.api.** { *; }
-keep class com.cashfree.pg.core.** { *; }
-keep class com.cashfree.pg.ui.** { *; }
-keep class com.cashfree.pg.cf_analytics.** { *; }
-dontwarn com.cashfree.**
-dontwarn com.cashfree.pg.**

# Keep Gson Serialized fields and Annotations used by Cashfree DropPaymentParser
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
-keepclassmembers class * {
    @com.google.gson.annotations.Expose <fields>;
}
-keep class com.google.gson.** { *; }
-dontwarn com.google.gson.**

# Networking and reflection dependencies used by Cashfree SDK
-dontwarn retrofit2.**
-dontwarn okhttp3.**
-dontwarn okio.**

# Easebuzz SDK
-keep class com.easebuzz.** { *; }
-keep class in.easebuzz.** { *; }
-keep class com.easebuzzsdk.** { *; }
-keep class datamodels.** { *; }
-dontwarn in.easebuzz.**

# Razorpay SDK
-keep class com.razorpay.** { *; }
-keep class com.reactnative.razorpay.** { *; }
-dontwarn com.razorpay.**

# Add any project specific keep options here:
