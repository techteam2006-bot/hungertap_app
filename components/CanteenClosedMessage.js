import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Pressable,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from './AppIcon';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../lib/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { appTypography } from '../lib/darkThemeConfig';
import { CANTEEN_STATUS_LOGO } from '../lib/appLogo';

const CanteenClosedMessage = ({ onRefresh }) => {
  const { colors, isDarkMode } = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const iconTint = isDarkMode ? 'rgba(245, 188, 59, 0.2)' : 'rgba(245, 188, 59, 0.12)';
  const hintBg = isDarkMode ? 'rgba(255, 255, 255, 0.08)' : colors.mutedRowBackground;
  const secondarySurface = isDarkMode ? 'rgba(255, 255, 255, 0.08)' : colors.elevatedSurface;
  const cardSurface = isDarkMode ? 'rgba(255, 255, 255, 0.07)' : colors.elevatedSurface;
  const cardOutline = isDarkMode ? colors.glassBorder : colors.border;

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.contentBackground }]}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: 24 + insets.bottom },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: cardSurface,
            borderColor: cardOutline,
            shadowColor: isDarkMode ? '#000000' : colors.shadow,
          },
        ]}
      >
        <LinearGradient
          colors={[colors.brandYellow, '#D4A017']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.cardAccent}
        />

        <Image source={CANTEEN_STATUS_LOGO} style={styles.brandMark} resizeMode="contain" />

        <View style={[styles.iconRing, { backgroundColor: iconTint }]}>
          <AppIcon name="moon-outline" size={36} color={colors.brandYellow} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Kitchen is closed</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Ordering is paused for now. You can still review your profile and past orders—we will be back
          when service hours resume.
        </Text>

        <View style={[styles.hint, { backgroundColor: hintBg, borderColor: cardOutline }]}>
          <AppIcon name="time-outline" size={20} color={colors.textTertiary} style={styles.hintIcon} />
          <Text style={[styles.hintText, { color: colors.textSecondary }]}>
            Tap refresh to check the latest status without leaving this screen.
          </Text>
        </View>

        <TouchableOpacity activeOpacity={0.88} onPress={onRefresh} style={styles.ctaWrap}>
          <LinearGradient
            colors={[colors.brandYellow, '#D4A017']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cta}
          >
            <AppIcon name="refresh" size={22} color="#FFFFFF" />
            <Text style={[styles.ctaLabel, styles.ctaLabelSpacing]}>Check again</Text>
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => navigation.navigate('ProfileTab')}
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                backgroundColor: secondarySurface,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <AppIcon name="person-outline" size={20} color={colors.text} />
            <Text style={[styles.secondaryLabel, { color: colors.text }]}>Profile</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('OrdersTab')}
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                backgroundColor: secondarySurface,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <AppIcon name="receipt-outline" size={20} color={colors.text} />
            <Text style={[styles.secondaryLabel, { color: colors.text }]}>Orders</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingBottom: 22,
    paddingTop: 20,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
    overflow: 'hidden',
  },
  cardAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  brandMark: {
    width: 72,
    height: 72,
    alignSelf: 'center',
    marginBottom: 12,
    marginTop: 8,
  },
  iconRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 22,
    fontFamily: appTypography.bold,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: appTypography.regular,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 18,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
  },
  hintIcon: {
    marginRight: 10,
    marginTop: 1,
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    fontFamily: appTypography.regular,
    lineHeight: 19,
  },
  ctaWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 14,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: appTypography.bold,
  },
  ctaLabelSpacing: {
    marginLeft: 10,
  },
  actionsRow: {
    flexDirection: 'row',
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryLabel: {
    fontSize: 15,
    fontFamily: appTypography.semiBold,
    marginLeft: 8,
  },
});

export default CanteenClosedMessage;
