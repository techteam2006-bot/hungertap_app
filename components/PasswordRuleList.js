import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import AppIcon from './AppIcon';
import { appTypography } from '../lib/darkThemeConfig';

export const MIN_PASSWORD = 8;

export const PASSWORD_RULES = [
  {
    id: 'len',
    label: 'Minimum 8 characters',
    test: (p) => p.length >= MIN_PASSWORD,
  },
  {
    id: 'upper',
    label: 'One uppercase letter',
    test: (p) => /[A-Z]/.test(p),
  },
  {
    id: 'lower',
    label: 'One lowercase letter',
    test: (p) => /[a-z]/.test(p),
  },
  {
    id: 'number',
    label: 'One number',
    test: (p) => /\d/.test(p),
  },
  {
    id: 'special',
    label: 'One special character',
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

export function passwordMeetsAllRules(password) {
  return PASSWORD_RULES.every((r) => r.test(password || ''));
}

/**
 * Live password requirement checklist (X → check as rules pass).
 */
export default function PasswordRuleList({
  password,
  mutedColor = '#9CA3AF',
  okColor = '#16A34A',
  dimmed = false,
  style,
}) {
  return (
    <View
      style={[styles.rulesWrap, dimmed && styles.dimmed, style]}
      accessibilityRole="summary"
    >
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(password || '');
        return (
          <View key={rule.id} style={styles.ruleRow}>
            <AppIcon
              name={ok ? 'checkmark-circle' : 'close-circle'}
              size={14}
              color={ok ? okColor : mutedColor}
            />
            <Text style={[styles.ruleText, { color: ok ? okColor : mutedColor }]}>
              {rule.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rulesWrap: {
    marginTop: -4,
    marginBottom: 12,
    paddingHorizontal: 4,
    gap: 4,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ruleText: {
    fontSize: 12,
    fontFamily: appTypography.regular,
  },
  dimmed: {
    opacity: 0.45,
  },
});
