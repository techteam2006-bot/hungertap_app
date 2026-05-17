import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/ThemeContext';
import NotificationService from '../lib/NotificationService';

const NotificationStatus = () => {
  const { colors } = useTheme();
  const isNotificationsAvailable = NotificationService.isNotificationsAvailable();

  // Only show if notifications are not available (Expo Go)
  if (isNotificationsAvailable) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        Alerts need the HungerTap mobile app on a phone or tablet.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
    gap: 8,
  },
  text: {
    fontSize: 12,
    flex: 1,
  },
});

export default NotificationStatus; 