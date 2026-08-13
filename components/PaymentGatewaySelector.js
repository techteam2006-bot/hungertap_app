import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../lib/ThemeContext';

export default function PaymentGatewaySelector({ gateways, selectedGateway, onSelectGateway }) {
  const { colors } = useTheme();

  // Hide selector UI if 0 or 1 gateway is available
  if (!Array.isArray(gateways) || gateways.length <= 1) return null;

  return (
    <View style={styles.container}>
      <Text style={[styles.headerText, { color: colors.text || '#FFFFFF' }]}>
        Payment Method
      </Text>
      {gateways.map((gw) => {
        const isSelected = selectedGateway === gw.code;
        return (
          <TouchableOpacity
            key={gw.code}
            activeOpacity={0.8}
            onPress={() => onSelectGateway(gw.code)}
            style={[
              styles.card,
              {
                backgroundColor: isSelected
                  ? (colors.primaryContainer || '#2A2415')
                  : (colors.surface || '#121212'),
                borderColor: isSelected
                  ? (colors.primary || '#E5A93B')
                  : (colors.border || '#333333'),
              },
            ]}
          >
            <View style={styles.radioRow}>
              <View
                style={[
                  styles.radioOuter,
                  { borderColor: isSelected ? (colors.primary || '#E5A93B') : '#666666' },
                ]}
              >
                {isSelected && (
                  <View
                    style={[
                      styles.radioInner,
                      { backgroundColor: colors.primary || '#E5A93B' },
                    ]}
                  />
                )}
              </View>

              <View style={styles.textContainer}>
                <View style={styles.titleRow}>
                  <Text style={[styles.title, { color: colors.text || '#FFFFFF' }]}>
                    {gw.display_name}
                  </Text>
                  {gw.is_default && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>RECOMMENDED</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.subText, { color: colors.textSecondary || '#AAAAAA' }]}>
                  UPI (GPay / PhonePe / Paytm / Cred), Cards & NetBanking
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 12 },
  headerText: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1.5, marginBottom: 8 },
  radioRow: { flexDirection: 'row', alignItems: 'center' },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  textContainer: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '600' },
  badge: { backgroundColor: 'rgba(229, 169, 59, 0.2)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { color: '#E5A93B', fontSize: 9, fontWeight: '800' },
  subText: { fontSize: 11, marginTop: 2 },
});
