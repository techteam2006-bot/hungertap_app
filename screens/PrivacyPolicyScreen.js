import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import AppIcon from '../components/AppIcon';
import { useTheme } from '../lib/ThemeContext';

const PrivacyPolicyScreen = ({ navigation }) => {
  const { colors, typography } = useTheme();
  const yellow = colors.brandYellow || '#F5BC3B';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: yellow }]}>
      <View style={[styles.statusStrip, { backgroundColor: yellow, height: 34 }]} />

      <View style={styles.header}>
        <View style={[styles.headerSide, styles.headerSideLeft]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <AppIcon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text, fontFamily: typography?.bold }]}>
            Privacy Policy
          </Text>
        </View>
        <View style={styles.headerSide} />
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Introduction
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            This Privacy Policy describes how Intellix Technologies ("we", "our", or "us") collects, uses, and shares information when you use the HungerTap App (the "Service").
          </Text>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Information We Collect
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            We collect information you provide directly to us, such as when you create an account, place an order, or contact us for support. This may include:
          </Text>
          <View style={styles.bulletList}>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Name and contact information</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Email address</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Order history and preferences</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Payment information (processed securely)</Text>
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            How We Use Your Information
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            We use the information we collect to:
          </Text>
          <View style={styles.bulletList}>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Process and fulfill your orders</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Provide customer support</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Improve our services</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Send important updates about your orders</Text>
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Data Security
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            We implement appropriate security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. Your data is encrypted and stored securely.
          </Text>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Your Rights
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            You have the right to access, update, or delete your personal information. You can also opt out of certain communications from us. To exercise these rights, please contact us.
          </Text>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Contact Us
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            If you have any questions about this Privacy Policy, please contact us at:
          </Text>
          <Text style={[styles.contactInfo, { color: colors.text, fontFamily: typography?.medium }]}>
            support@hungertap.online
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statusStrip: {
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 128, 128, 0.2)',
  },
  headerSide: {
    width: 48,
    justifyContent: 'center',
  },
  headerSideLeft: {
    alignItems: 'flex-start',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 17,
    marginBottom: 12,
  },
  sectionContent: {
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 12,
  },
  bulletList: {
    marginTop: 8,
  },
  bulletPoint: {
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 4,
  },
  contactInfo: {
    fontSize: 15,
    marginTop: 8,
  },
});

export default PrivacyPolicyScreen;
