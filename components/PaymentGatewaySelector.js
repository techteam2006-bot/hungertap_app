import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../lib/ThemeContext';
import AppIcon from './AppIcon';
import { appTypography } from '../lib/darkThemeConfig';

/**
 * Format gateway title for the cart selector (name only — no Production/Testing labels).
 */
function formatGatewayDisplayName(gw) {
  const code = String(gw?.code || '').toLowerCase();
  const name = String(gw?.display_name || '').trim();

  if (code.includes('cashfree') || name.toLowerCase().includes('cashfree')) {
    return 'Cashfree';
  }
  if (code.includes('easebuzz') || name.toLowerCase().includes('easebuzz')) {
    return 'Easebuzz';
  }
  if (code.includes('razorpay') || name.toLowerCase().includes('razorpay')) {
    return 'Razorpay';
  }

  return name.replace(/\s*\([^)]*\)/g, '').trim() || 'Payment';
}

export default function PaymentGatewaySelector({ gateways, selectedGateway, onSelectGateway }) {
  const { colors, isDarkMode } = useTheme();

  // Hide selector UI if 0 or 1 gateway is available
  if (!Array.isArray(gateways) || gateways.length <= 1) return null;

  const brandYellow = colors.brandYellow || '#FFB301';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <AppIcon name="wallet-outline" size={18} color={brandYellow} />
          <Text
            style={[
              styles.headerTitle,
              { color: colors.text, fontFamily: appTypography.bold },
            ]}
          >
            Payment Options
          </Text>
        </View>
        <View style={styles.secureTag}>
          <AppIcon name="shield-checkmark-outline" size={12} color="#10B981" />
          <Text style={styles.secureText}>100% SECURE</Text>
        </View>
      </View>

      {gateways.map((gw) => {
        const isSelected = selectedGateway === gw.code;
        const displayName = formatGatewayDisplayName(gw);

        return (
          <TouchableOpacity
            key={gw.code}
            activeOpacity={0.75}
            onPress={() => onSelectGateway(gw.code)}
            style={[
              styles.card,
              {
                backgroundColor: colors.elevatedSurface,
                borderColor: isSelected ? brandYellow : colors.border,
                borderWidth: isSelected ? 1.5 : 1,
              },
            ]}
          >
            <View style={styles.contentRow}>
              {/* Radio Indicator matching app theme */}
              <View
                style={[
                  styles.radioButton,
                  {
                    borderColor: isSelected ? brandYellow : (isDarkMode ? '#555555' : '#CCCCCC'),
                    backgroundColor: isSelected ? brandYellow : 'transparent',
                  },
                ]}
              >
                {isSelected && <View style={styles.radioButtonInner} />}
              </View>

              {/* Main Info */}
              <View style={styles.infoCol}>
                <View style={styles.titleRow}>
                  <Text
                    style={[
                      styles.gatewayName,
                      {
                        color: colors.text,
                        fontFamily: appTypography.bold,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {displayName}
                  </Text>
                  {gw.is_default && (
                    <View style={[styles.badge, { backgroundColor: brandYellow }]}>
                      <Text style={styles.badgeText}>RECOMMENDED</Text>
                    </View>
                  )}
                </View>

                <Text
                  style={[
                    styles.subText,
                    {
                      color: colors.textSecondary,
                      fontFamily: appTypography.regular,
                    },
                  ]}
                  numberOfLines={1}
                >
                  UPI, Cards & NetBanking
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
  container: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  headerTitle: {
    fontSize: 15,
  },
  secureTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  secureText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
    letterSpacing: 0.3,
  },
  card: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radioButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioButtonInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#000000',
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  gatewayName: {
    fontSize: 14.5,
    flexShrink: 1,
    marginRight: 8,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  subText: {
    fontSize: 11.5,
    lineHeight: 15,
  },
});
