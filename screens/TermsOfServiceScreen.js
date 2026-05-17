import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/ThemeContext';

const TermsOfServiceScreen = ({ navigation }) => {
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
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text, fontFamily: typography?.bold }]}>
            Terms and Conditions
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
            Agreement to Terms
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            By accessing and using the HungerTap App, you accept and agree to be bound by the terms and provision of this agreement. These Terms and Conditions govern your use of our service.
          </Text>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Use License
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            Permission is granted to temporarily download one copy of the HungerTap App for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:
          </Text>
          <View style={styles.bulletList}>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Modify or copy the materials</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Use the materials for any commercial purpose</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Attempt to reverse engineer any software</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Remove any copyright or proprietary notations</Text>
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            User Responsibilities
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            As a user of our service, you agree to:
          </Text>
          <View style={styles.bulletList}>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Provide accurate and complete information</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Use the service only for lawful purposes</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Respect other users and staff</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Pay for orders in a timely manner</Text>
            <Text style={[styles.bulletPoint, { color: colors.textSecondary, fontFamily: typography?.regular }]}>• Not abuse or misuse the service</Text>
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Orders and Payments
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            All orders placed through the app are subject to availability and confirmation. Payment must be made at the time of order placement. We reserve the right to refuse or cancel orders at our discretion.
          </Text>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Limitation of Liability
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            In no event shall Intellix Technologies or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the service.
          </Text>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Privacy Policy
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            Your privacy is important to us. Please review our Privacy Policy, which also governs your use of the service, to understand our practices.
          </Text>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Changes to Terms
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            We reserve the right to modify these terms at any time. We will notify users of any material changes via the app or email. Continued use of the service after changes constitutes acceptance of the new terms.
          </Text>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, fontFamily: typography?.semiBold }]}>
            Contact Information
          </Text>
          <Text style={[styles.sectionContent, { color: colors.textSecondary, fontFamily: typography?.regular }]}>
            If you have any questions about these Terms and Conditions, please contact us at:
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

export default TermsOfServiceScreen;
