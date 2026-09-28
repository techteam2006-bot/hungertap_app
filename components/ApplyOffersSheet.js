import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from './AppIcon';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';
/**
 * Bottom sheet: list of available offers + coupon code entry.
 */
export default function ApplyOffersSheet({
  visible,
  offers = [],
  loading = false,
  loadError = '',
  appliedOffer = null,
  subtotal = 0,
  onClose,
  onSelectOffer,
  onApplyCode,
  onRemoveOffer,
}) {
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const [couponDraft, setCouponDraft] = useState('');
  const [localError, setLocalError] = useState('');
  const brandYellow = colors.brandYellow || '#E5A93B';

  useEffect(() => {
    if (!visible) return;
    setCouponDraft(appliedOffer?.code || '');
    setLocalError('');
  }, [visible, appliedOffer?.code]);

  const appliedCode = appliedOffer?.code || null;

  const sortedOffers = useMemo(() => {
    const list = Array.isArray(offers) ? [...offers] : [];
    return list.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  }, [offers]);

  if (!visible) return null;

  const handleApplyCode = async () => {
    setLocalError('');
    const result = await Promise.resolve(onApplyCode?.(couponDraft));
    if (result && result.ok === false) {
      setLocalError(result.error || 'Could not apply coupon.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.overlay, { paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close offers" />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.elevatedSurface,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.handleRow}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
        </View>

        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <AppIcon name="pricetag-outline" size={20} color={brandYellow} />
            <Text style={[styles.title, { color: colors.text, fontFamily: appTypography.bold }]}>
              Apply offers
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button">
            <AppIcon name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.subtitle, { color: colors.textSecondary, fontFamily: appTypography.regular }]}>
          Pick an offer below or enter a coupon code.
        </Text>

        <View
          style={[
            styles.couponRow,
            {
              backgroundColor: colors.inputBackground || (isDarkMode ? '#1A1A1A' : '#F5F5F5'),
              borderColor: localError ? colors.error : colors.border,
            },
          ]}
        >
          <TextInput
            style={[
              styles.couponInput,
              { color: colors.text, fontFamily: appTypography.semiBold || appTypography.bold },
            ]}
            value={couponDraft}
            onChangeText={(t) => {
              setCouponDraft(String(t || '').toUpperCase());
              if (localError) setLocalError('');
            }}
            placeholder="Enter coupon code"
            placeholderTextColor={colors.inputPlaceholder || colors.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={32}
            returnKeyType="done"
            onSubmitEditing={handleApplyCode}
            underlineColorAndroid="transparent"
          />
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: brandYellow }]}
            onPress={handleApplyCode}
            accessibilityRole="button"
            accessibilityLabel="Apply coupon"
          >
            <Text style={[styles.applyBtnText, { fontFamily: appTypography.bold }]}>Apply</Text>
          </TouchableOpacity>
        </View>
        {localError ? (
          <View style={[styles.errorBanner, { backgroundColor: isDarkMode ? 'rgba(239,68,68,0.12)' : '#FEF2F2' }]}>
            <Text style={[styles.errorText, { color: colors.error, fontFamily: appTypography.regular }]}>
              {localError}
            </Text>
          </View>
        ) : null}

        {appliedOffer ? (
          <View
            style={[
              styles.appliedBanner,
              {
                backgroundColor: isDarkMode ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.1)',
                borderColor: '#10B981',
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.appliedTitle, { color: colors.text, fontFamily: appTypography.bold }]}>
                {appliedOffer.code} applied
              </Text>
            </View>
            <TouchableOpacity onPress={onRemoveOffer} hitSlop={8}>
              <Text style={[styles.removeText, { color: colors.error, fontFamily: appTypography.semiBold }]}>
                Remove
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={[styles.sectionLabel, { color: colors.text, fontFamily: appTypography.bold }]}>
          Available offers
        </Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={brandYellow} />
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {sortedOffers.length === 0 ? (
              <Text
                style={[
                  styles.emptyText,
                  { color: colors.textTertiary, fontFamily: appTypography.regular },
                ]}
              >
                {loadError
                  ? 'Offers are unavailable right now. You can still try a coupon code.'
                  : 'No offers available at the moment.'}
              </Text>
            ) : (
              sortedOffers.map((offer) => {
                const selected = appliedCode && offer.code === appliedCode;
                const belowMin = subtotal < (offer.min_order_amount || 0);
                return (
                  <TouchableOpacity
                    key={offer.id || offer.code}
                    activeOpacity={0.8}
                    onPress={async () => {
                      setLocalError('');
                      const result = await Promise.resolve(onSelectOffer?.(offer));
                      if (result && result.ok === false) {
                        setLocalError(result.error || 'Could not apply offer.');
                      }
                    }}
                    style={[
                      styles.offerCard,
                      {
                        backgroundColor: colors.mutedRowBackground || colors.contentBackground,
                        borderColor: selected ? brandYellow : colors.border,
                        borderWidth: selected ? 1.5 : 1,
                        opacity: belowMin ? 0.72 : 1,
                      },
                    ]}
                  >
                    <View style={styles.offerTop}>
                      <View style={[styles.codeChip, { backgroundColor: 'rgba(245,188,59,0.18)' }]}>
                        <Text
                          style={[styles.codeChipText, { color: brandYellow, fontFamily: appTypography.bold }]}
                        >
                          {offer.code}
                        </Text>
                      </View>
                      {selected ? (
                        <AppIcon name="checkmark-circle" size={20} color="#10B981" />
                      ) : (
                        <Text
                          style={[styles.selectHint, { color: brandYellow, fontFamily: appTypography.semiBold }]}
                        >
                        Tap to apply
                        </Text>
                      )}
                    </View>
                    <View style={styles.offerBody}>
                      <Text style={[styles.offerTitle, { color: colors.text, fontFamily: appTypography.bold }]}>
                        {offer.title}
                      </Text>
                      {offer.description ? (
                        <Text
                          style={[
                            styles.offerDesc,
                            { color: colors.textSecondary, fontFamily: appTypography.regular },
                          ]}
                        >
                          {offer.description}
                        </Text>
                      ) : null}
                    </View>
                    {offer.min_order_amount > 0 ? (
                      <Text
                        style={[
                          styles.offerMin,
                          {
                            color: belowMin ? colors.error : colors.textTertiary,
                            fontFamily: appTypography.regular,
                          },
                        ]}
                      >
                        Min. order ₹{offer.min_order_amount}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 1000,
    elevation: 1000,
  },
  sheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  couponRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingLeft: 12,
    paddingVertical: 4,
    marginBottom: 8,
  },
  couponInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
    letterSpacing: 0.5,
  },
  applyBtn: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 4,
  },
  applyBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  errorBanner: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
  },
  appliedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    gap: 10,
  },
  appliedTitle: {
    fontSize: 14,
  },
  appliedSub: {
    fontSize: 12,
    marginTop: 2,
  },
  removeText: {
    fontSize: 13,
  },
  sectionLabel: {
    fontSize: 15,
    marginBottom: 10,
  },
  loadingBox: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: 8,
    gap: 10,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 12,
  },
  offerCard: {
    borderRadius: 12,
    padding: 14,
  },
  offerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  codeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  codeChipText: {
    fontSize: 12,
    letterSpacing: 0.6,
  },
  selectHint: {
    fontSize: 12,
  },
  offerTitle: {
    fontSize: 16,
    marginBottom: 4,
  },
  offerSavings: {
    fontSize: 13,
    marginBottom: 4,
  },
  offerDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  offerMin: {
    fontSize: 11,
    marginTop: 6,
  },
});
