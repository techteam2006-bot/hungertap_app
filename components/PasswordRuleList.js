import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import AppIcon from './AppIcon';
import { appTypography } from '../lib/darkThemeConfig';

export const MIN_PASSWORD = 8;

export const PASSWORD_RULES = [
  {
    id: 'len',
    label: '8+ characters',
    test: (p) => p.length >= MIN_PASSWORD,
  },
  {
    id: 'upper',
    label: 'uppercase letter',
    test: (p) => /[A-Z]/.test(p),
  },
  {
    id: 'lower',
    label: 'lowercase letter',
    test: (p) => /[a-z]/.test(p),
  },
  {
    id: 'number',
    label: 'number',
    test: (p) => /\d/.test(p),
  },
  {
    id: 'special',
    label: 'special character',
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

export function passwordMeetsAllRules(password) {
  return PASSWORD_RULES.every((r) => r.test(password || ''));
}

/**
 * Compact password hints — one line, only rules still missing.
 */
export default function PasswordRuleList({
  password,
  mutedColor = '#9CA3AF',
  okColor = '#16A34A',
  dimmed = false,
  style,
}) {
  const missed = useMemo(
    () => PASSWORD_RULES.filter((rule) => !rule.test(password || '')),
    [password]
  );

  if (dimmed || missed.length === 0) {
    return null;
  }

  const hint = missed.map((rule) => rule.label).join(' · ');

  return (
    <View
      style={[styles.rulesWrap, style]}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
    >
      <AppIcon name="information-circle-outline" size={14} color={mutedColor} />
      <Text style={[styles.ruleText, { color: mutedColor }]} numberOfLines={2}>
        Still need: {hint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rulesWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: -4,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  ruleText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: appTypography.regular,
  },
});
