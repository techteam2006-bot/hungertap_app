import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  Linking,
  Alert,
  Image,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AppIcon from '../components/AppIcon';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';
import splashCatLogo from '../assets/hungertap-global-loading.png';

const { width, height } = Dimensions.get('window');

const SUPPORT_EMAIL = 'support@hungertap.online';

const TIPS = [
  {
    icon: 'mail-outline',
    text: 'Sign in with your registered email address.',
  },
  {
    icon: 'key-outline',
    text: 'We’ll email a 6-digit verification code. Enter it on the Verify Email screen—no password needed.',
  },
  {
    icon: 'shield-checkmark-outline',
    text: 'If the code doesn’t arrive, check spam/junk, then tap Resend Code after the timer.',
  },
  {
    icon: 'wifi-outline',
    text: 'Use a stable internet connection. If something fails, wait a moment and try again.',
  },
];

const createStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.loginCanvas,
    },
    topStrip: {
      height: 34,
      width: '100%',
    },
    body: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      backgroundColor: colors.elevatedSurface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backButton: {
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerTitle: {
      flex: 1,
      fontSize: 20,
      fontFamily: appTypography.bold,
      color: colors.text,
      textAlign: 'center',
    },
    headerSpacer: {
      width: 32,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: width * 0.06,
      paddingTop: height * 0.018,
      paddingBottom: height * 0.1,
    },
    centerBlock: {
      width: '100%',
    },
    intro: {
      marginBottom: height * 0.024,
      alignItems: 'center',
    },
    introLogo: {
      width: width * 0.22,
      height: width * 0.22,
      marginBottom: height * 0.016,
    },
    introTitle: {
      fontSize: width * 0.055,
      fontFamily: appTypography.bold,
      textAlign: 'center',
      marginBottom: height * 0.01,
      color: colors.text,
    },
    actionCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.elevatedSurface,
      marginBottom: height * 0.018,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 2,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: height * 0.016,
      paddingHorizontal: width * 0.045,
    },
    actionIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary + '18',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: width * 0.035,
    },
    actionTextWrap: {
      flex: 1,
    },
    actionTitle: {
      fontSize: width * 0.042,
      fontFamily: appTypography.medium,
      color: colors.text,
      marginBottom: 2,
    },
    actionSubtitle: {
      fontSize: width * 0.033,
      fontFamily: appTypography.regular,
      color: colors.textSecondary,
    },
    tipsCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.elevatedSurface,
      padding: width * 0.045,
      marginTop: height * 0.008,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 6,
      elevation: 2,
    },
    tipsHeading: {
      fontSize: width * 0.04,
      fontFamily: appTypography.medium,
      color: colors.text,
      marginBottom: height * 0.014,
    },
    tipRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: height * 0.014,
    },
    tipIcon: {
      marginRight: width * 0.03,
      marginTop: 2,
    },
    tipText: {
      flex: 1,
      fontSize: width * 0.036,
      fontFamily: appTypography.regular,
      lineHeight: width * 0.05,
      color: colors.textSecondary,
    },
  });

/**
 * Help for sign-in / sign-up — not the same as app Feedback (email/contact).
 */
const AuthHelpScreen = ({ navigation }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const handleEmailPress = async () => {
    const subject = 'Account help — HungerTap';
    const body =
      'Hi,\n\nI need help with my account (sign-in / sign-up):\n\n' +
      '• What I tried:\n\n' +
      '• What happened:\n\n';

    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try {
      const canOpen = await Linking.canOpenURL(mailtoUrl);
      if (canOpen) {
        await Linking.openURL(mailtoUrl);
      } else {
        Alert.alert(
          'No email app found',
          `You can reach us at:\n${SUPPORT_EMAIL}`,
          [
            {
              text: 'Copy Email',
              onPress: () => {
                Clipboard.setStringAsync(SUPPORT_EMAIL);
                Alert.alert('Copied!', 'Email address copied to clipboard.');
              },
            },
            { text: 'OK', style: 'cancel' },
          ]
        );
      }
    } catch {
      Alert.alert(
        'No email app found',
        `You can reach us at:\n${SUPPORT_EMAIL}`,
        [
          {
            text: 'Copy Email',
            onPress: () => {
              Clipboard.setStringAsync(SUPPORT_EMAIL);
              Alert.alert('Copied!', 'Email address copied to clipboard.');
            },
          },
          { text: 'OK', style: 'cancel' },
        ]
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.topStrip, { backgroundColor: colors.brandYellow }]} />
      <StatusBar barStyle="dark-content" backgroundColor={colors.brandYellow} />
      <View style={styles.body}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <AppIcon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Account help
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.centerBlock}>
            <View style={styles.intro}>
              <Image source={splashCatLogo} style={styles.introLogo} resizeMode="contain" />
              <Text style={styles.introTitle}>Having trouble signing in?</Text>
            </View>

            <View style={styles.actionCard}>
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => navigation.navigate('ForgotPassword')}
                activeOpacity={0.75}
              >
                <View style={styles.actionIconWrap}>
                  <AppIcon name="lock-open-outline" size={22} color={colors.primary} />
                </View>
                <View style={styles.actionTextWrap}>
                  <Text style={styles.actionTitle}>Reset my password</Text>
                  <Text style={styles.actionSubtitle}>Get a code by email and choose a new password</Text>
                </View>
                <AppIcon name="chevron-forward" size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            <View style={styles.actionCard}>
              <TouchableOpacity style={styles.actionRow} onPress={handleEmailPress} activeOpacity={0.75}>
                <View style={styles.actionIconWrap}>
                  <AppIcon name="mail-outline" size={22} color={colors.primary} />
                </View>
                <View style={styles.actionTextWrap}>
                  <Text style={styles.actionTitle}>Contact us by email</Text>
                  <Text style={styles.actionSubtitle} numberOfLines={2}>
                    {SUPPORT_EMAIL} — opens your mail app
                  </Text>
                </View>
                <AppIcon name="chevron-forward" size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            <View style={styles.tipsCard}>
              <Text style={styles.tipsHeading}>Quick tips</Text>
              {TIPS.map((tip, index) => (
                <View key={index} style={[styles.tipRow, index === TIPS.length - 1 && { marginBottom: 0 }]}>
                  <AppIcon name={tip.icon} size={18} color={colors.textTertiary} style={styles.tipIcon} />
                  <Text style={styles.tipText}>{tip.text}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

export default AuthHelpScreen;
