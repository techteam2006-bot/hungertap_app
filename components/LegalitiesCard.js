import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import AppIcon from './AppIcon';
import { GlassCard } from './ModernComponents';
import { appTypography } from '../lib/darkThemeConfig';
import { LEGAL_LINKS, openLegalUrl } from '../lib/legalLinks';

function LegalitiesRow({ icon, title, onPress, colors, isLast }) {
  return (
    <TouchableOpacity
      style={[styles.row, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.65}
    >
      <View style={[styles.iconPill, { backgroundColor: colors.mutedRowBackground }]}>
        <AppIcon name={icon} size={22} color={colors.textSecondary} />
      </View>
      <View style={styles.rowTextBlock}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <AppIcon name="chevron-forward" size={20} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

export default function LegalitiesCard({ colors, style }) {
  return (
    <GlassCard
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.elevatedSurface }, style]}
    >
      <LegalitiesRow
        icon="document-text-outline"
        title="Terms of Service"
        colors={colors}
        onPress={() => openLegalUrl(LEGAL_LINKS.termsOfService)}
      />
      <LegalitiesRow
        icon="refresh-outline"
        title="Refund Policies"
        colors={colors}
        onPress={() => openLegalUrl(LEGAL_LINKS.refundPolicy)}
      />
      <LegalitiesRow
        icon="shield-checkmark-outline"
        title="Privacy Policy"
        colors={colors}
        isLast
        onPress={() => openLegalUrl(LEGAL_LINKS.privacyPolicy)}
      />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  iconPill: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rowTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 16,
    fontFamily: appTypography.semiBold,
  },
});
