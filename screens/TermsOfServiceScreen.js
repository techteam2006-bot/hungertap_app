import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { LEGAL_PAGES } from '../lib/legalLinks';
import { useTheme } from '../lib/ThemeContext';

/** Redirects to in-app LegalWebView (keeps old route names working). */
const TermsOfServiceScreen = ({ navigation }) => {
  const { colors } = useTheme();
  const page = LEGAL_PAGES.termsOfService;

  useEffect(() => {
    navigation.replace('LegalWebView', {
      title: page.title,
      url: page.url,
    });
  }, [navigation, page.title, page.url]);

  return (
    <View style={[styles.root, { backgroundColor: colors.contentBackground }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default TermsOfServiceScreen;
