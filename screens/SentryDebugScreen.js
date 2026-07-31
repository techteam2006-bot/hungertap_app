/**
 * DEV-only Sentry validation screen.
 * Gated by __DEV__ at import/navigation sites — not registered in production navigators.
 *
 * Do not trigger tests automatically; each button is manual.
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  NativeModules,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import AppIcon from '../components/AppIcon';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';

const LOG_TAG = 'HungerTapSentry';

function logTest(name) {
  // eslint-disable-next-line no-console
  console.log(`[${LOG_TAG}] Runtime test starting: ${name}`);
}

function TestButton({ title, subtitle, onPress, colors, danger }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[
        styles.btn,
        {
          backgroundColor: danger ? '#B91C1C' : colors.elevatedSurface,
          borderColor: danger ? '#7F1D1D' : colors.border,
        },
      ]}
    >
      <Text style={[styles.btnTitle, { color: danger ? '#FFFFFF' : colors.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.btnSub, { color: danger ? '#FECACA' : colors.textTertiary }]}>
          {subtitle}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function SentryDebugScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const onCaptureMessage = useCallback(() => {
    logTest('Capture Message');
    const id = Sentry.captureMessage('[HungerTapSentry] Debug: captureMessage');
    Alert.alert('Sent', `captureMessage queued (event id hint: ${id || 'n/a'}). Check Sentry Issues.`);
  }, []);

  const onCaptureException = useCallback(() => {
    logTest('Capture Exception');
    try {
      throw new Error('[HungerTapSentry] Debug: captured exception');
    } catch (e) {
      const id = Sentry.captureException(e);
      Alert.alert('Sent', `captureException queued (event id hint: ${id || 'n/a'}).`);
    }
  }, []);

  const onUnhandledJs = useCallback(() => {
    logTest('Unhandled JS Crash');
    Alert.alert(
      'Unhandled JS crash',
      'This will throw outside a try/catch after you confirm. The app may show a redbox / reload.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Crash',
          style: 'destructive',
          onPress: () => {
            // Defer so Alert can dismiss; still an unhandled rejection/throw on JS thread
            setTimeout(() => {
              throw new Error('[HungerTapSentry] Debug: unhandled JS exception');
            }, 100);
          },
        },
      ]
    );
  }, []);

  const onNativeCrash = useCallback(() => {
    logTest('Native Crash');
    Alert.alert(
      'Native crash',
      'Calls Sentry.nativeCrash(). The process will die. Relaunch so Sentry can flush the event.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Crash native',
          style: 'destructive',
          onPress: () => {
            // eslint-disable-next-line no-console
            console.log(`[${LOG_TAG}] Calling Sentry.nativeCrash()`);
            Sentry.nativeCrash();
          },
        },
      ]
    );
  }, []);

  const onAnr = useCallback(() => {
    logTest('ANR Test');
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Not supported here',
        'Android ANR uses HungerTapSentryDebug.triggerAnr (main-thread sleep). On iOS, use App Hang tracking separately.'
      );
      return;
    }
    const mod = NativeModules.HungerTapSentryDebug;
    if (!mod?.triggerAnr) {
      Alert.alert(
        'Module missing',
        'HungerTapSentryDebug native module not found. Rebuild the Android app after adding HungerTapSentryDebugPackage.'
      );
      return;
    }
    Alert.alert(
      'ANR test',
      'Blocks the Android main thread for ~8s. UI will freeze; Sentry may report an ApplicationNotResponding event. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block 8s',
          style: 'destructive',
          onPress: () => {
            // eslint-disable-next-line no-console
            console.log(`[${LOG_TAG}] Invoking HungerTapSentryDebug.triggerAnr(8000)`);
            mod.triggerAnr(8000);
          },
        },
      ]
    );
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.back}>
          <AppIcon name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Sentry Debug</Text>
        <View style={styles.back} />
      </View>
      <Text style={[styles.banner, { color: colors.textTertiary, borderColor: colors.border }]}>
        __DEV__ only. Manual tests — nothing runs automatically. Watch Logcat tag HungerTapSentry.
      </Text>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TestButton
          title="Capture Message"
          subtitle="Sentry.captureMessage — handled event"
          onPress={onCaptureMessage}
          colors={colors}
        />
        <TestButton
          title="Capture Exception"
          subtitle="try/catch + Sentry.captureException"
          onPress={onCaptureException}
          colors={colors}
        />
        <TestButton
          title="Unhandled JS Crash"
          subtitle="Thrown outside try/catch (JS fatal)"
          onPress={onUnhandledJs}
          colors={colors}
          danger
        />
        <TestButton
          title="Native Crash"
          subtitle="Sentry.nativeCrash() — process dies"
          onPress={onNativeCrash}
          colors={colors}
          danger
        />
        <TestButton
          title="ANR Test"
          subtitle="Android: sleep main thread 8s (if supported)"
          onPress={onAnr}
          colors={colors}
          danger
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  back: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: appTypography.semiBold,
    fontSize: 18,
  },
  banner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: appTypography.regular,
  },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },
  btn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  btnTitle: { fontFamily: appTypography.semiBold, fontSize: 16 },
  btnSub: { marginTop: 4, fontSize: 13, lineHeight: 18, fontFamily: appTypography.regular },
});
