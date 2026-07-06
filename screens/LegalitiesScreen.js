import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import AppIcon from '../components/AppIcon';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';
import LegalitiesCard from '../components/LegalitiesCard';

const LegalitiesScreen = ({ navigation }) => {
  const { colors, isDarkMode } = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: colors.contentBackground }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={colors.brandYellow} />
      <View style={[styles.strip, { backgroundColor: colors.brandYellow }]} />

      <View style={[styles.header, { backgroundColor: colors.elevatedSurface }]}>
        <View style={styles.headerSide}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <AppIcon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          Legalities
        </Text>
        <View style={styles.headerSide} />
      </View>

      <View style={[styles.headerSeparator, { backgroundColor: colors.border }]} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: colors.textSecondary }]}>
          Review our policies below.
        </Text>
        <LegalitiesCard colors={colors} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  strip: {
    height: 34,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerSide: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontFamily: appTypography.bold,
  },
  headerSeparator: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 32,
  },
  intro: {
    fontSize: 14,
    fontFamily: appTypography.regular,
    lineHeight: 20,
    marginBottom: 16,
    marginLeft: 4,
  },
});

export default LegalitiesScreen;
