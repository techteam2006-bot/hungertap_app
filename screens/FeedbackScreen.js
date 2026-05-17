import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  StatusBar,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';
import { SPLASH_SCREEN_LOGO } from '../lib/appLogo';
import { pxToPercentX, pxToPercentY } from '../utils/percent';

const SUPPORT_EMAIL = 'support@hungertap.online';

const createStyles = (colors, isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.pageBackground,
    },
    topStrip: {
      height: 34,
      width: '100%',
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
      textAlign: 'center',
      color: colors.text,
    },
    headerSpacer: {
      width: 32,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: pxToPercentX(48),
      paddingTop: pxToPercentY(40),
      paddingBottom: pxToPercentY(80),
    },
    hero: {
      alignItems: 'center',
      marginBottom: pxToPercentY(32),
    },
    heroIconWrap: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: isDarkMode ? '#000000' : '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: pxToPercentY(20),
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 4,
    },
    heroLogo: {
      width: 68,
      height: 68,
    },
    heroTitle: {
      fontSize: 24,
      fontFamily: appTypography.bold,
      color: colors.text,
      textAlign: 'center',
      marginBottom: pxToPercentY(10),
    },
    heroSubtitle: {
      fontSize: 15,
      fontFamily: appTypography.regular,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      maxWidth: 320,
    },
    card: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.elevatedSurface,
      padding: 20,
      marginBottom: pxToPercentY(16),
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 3,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    infoIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary + '22',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    infoTitle: {
      fontSize: 17,
      fontFamily: appTypography.bold,
      color: colors.text,
      marginBottom: 8,
    },
    infoDescription: {
      fontSize: 14,
      fontFamily: appTypography.regular,
      lineHeight: 21,
      color: colors.textSecondary,
    },
    contactHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    contactIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary + '22',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    contactTitle: {
      fontSize: 17,
      fontFamily: appTypography.bold,
      color: colors.text,
      marginBottom: 4,
    },
    contactSubtitle: {
      fontSize: 13,
      fontFamily: appTypography.regular,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    emailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    emailText: {
      flex: 1,
      marginLeft: 12,
      fontSize: 15,
      fontFamily: appTypography.semiBold,
      color: colors.text,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.elevatedSurface,
      padding: 16,
      marginTop: pxToPercentY(4),
    },
    metaText: {
      flex: 1,
      marginLeft: 12,
      fontSize: 14,
      fontFamily: appTypography.regular,
      color: colors.textSecondary,
      lineHeight: 20,
    },
  });

const FeedbackScreen = ({ navigation }) => {
  const { colors, isDarkMode } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDarkMode), [colors, isDarkMode]);

  const handleEmailPress = async () => {
    const subject = 'Feedback — HungerTap';
    const body = 'Hi,\n\nI would like to share my feedback:\n\n';

    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try {
      const canOpen = await Linking.canOpenURL(mailtoUrl);
      if (canOpen) {
        await Linking.openURL(mailtoUrl);
      } else {
        Alert.alert(
          'Email app not available',
          `Install an email app or write to ${SUPPORT_EMAIL} from your browser.`,
          [{ text: 'OK' }]
        );
      }
    } catch {
      Alert.alert('Error', 'Unable to open your email app. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.topStrip, { backgroundColor: colors.brandYellow }]} />
      <StatusBar barStyle="dark-content" backgroundColor={colors.brandYellow} />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Feedback
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Image source={SPLASH_SCREEN_LOGO} style={styles.heroLogo} resizeMode="contain" />
          </View>
          <Text style={styles.heroTitle}>We would love to hear from you</Text>
          <Text style={styles.heroSubtitle}>
            Share ideas, report a problem, or tell us what is working well. Your message goes straight to our team.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
              <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>Help us improve</Text>
              <Text style={styles.infoDescription}>
                Feedback shapes updates to ordering, notifications, and the overall experience for everyone on campus.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.contactHeaderRow}>
            <View style={styles.contactIconWrap}>
              <Ionicons name="mail-outline" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactTitle}>Send feedback by email</Text>
              <Text style={styles.contactSubtitle}>Opens your mail app with the subject line ready.</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.emailRow} onPress={handleEmailPress} activeOpacity={0.75}>
            <Ionicons name="send-outline" size={20} color={colors.brandOrange} />
            <Text style={styles.emailText} numberOfLines={2}>
              {SUPPORT_EMAIL}
            </Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={22} color={colors.textTertiary} />
          <Text style={styles.metaText}>We typically respond within 24 hours on business days.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default FeedbackScreen;
