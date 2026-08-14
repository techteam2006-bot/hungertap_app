import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  ScrollView,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import AppIcon from '../components/AppIcon';
import BrandYellowStrip from '../components/BrandYellowStrip';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';
import { pxToPercentX, pxToPercentY } from '../utils/percent';
import splashCatLogo from '../assets/logo.png';

const { width, height } = Dimensions.get('window');

const SUPPORT_EMAIL = 'support@hungertap.online';

const createStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.pageBackground,
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
      paddingTop: pxToPercentY(48),
      paddingBottom: pxToPercentY(80),
    },
    hero: {
      alignItems: 'center',
      marginBottom: pxToPercentY(40),
    },
    heroLogo: {
      width: width * 0.22,
      height: width * 0.22,
      marginBottom: height * 0.016,
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
      marginBottom: pxToPercentY(20),
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 3,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    cardIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary + '22',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    cardTitle: {
      fontSize: 17,
      fontFamily: appTypography.bold,
      color: colors.text,
      marginBottom: 4,
    },
    cardSubtitle: {
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
      paddingVertical: 8,
      paddingHorizontal: 4,
      backgroundColor: 'transparent',
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

const ContactUsScreen = ({ navigation }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const handleEmailPress = async () => {
    const subject = 'Contact from HungerTap';
    const body = 'Hi,\n\nI would like to contact you regarding:\n\n';

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
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <BrandYellowStrip />

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
          Contact us
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
          <Image source={splashCatLogo} style={styles.heroLogo} resizeMode="contain" />
          <Text style={styles.heroTitle}>Get in touch</Text>
          <Text style={styles.heroSubtitle}>
            Questions about orders, your account, or the app? We are happy to help.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardIconWrap}>
              <AppIcon name="chatbubbles-outline" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Email support</Text>
              <Text style={styles.cardSubtitle}>Tap below to open your mail app with our address filled in.</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.emailRow}
            onPress={handleEmailPress}
            activeOpacity={0.75}
          >
            <AppIcon name="mail-outline" size={22} color={colors.brandOrange} />
            <Text style={styles.emailText} numberOfLines={2}>
              {SUPPORT_EMAIL}
            </Text>
            <AppIcon name="chevron-forward" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
};

export default ContactUsScreen;
