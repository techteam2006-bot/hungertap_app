import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  useWindowDimensions,
  Image,
  Animated,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';
import { LinearGradient } from 'expo-linear-gradient';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import { useCart } from '../lib/CartContext';
import { useTheme } from '../lib/ThemeContext';
import { shouldShowRecommendations } from '../lib/utils/recommendations';
import {
  supabase,
  prepareCheckoutOrderArgs,
  getUserCanteenId,
  validateCartItemsForUserCanteen,
  deriveItemIsAvailable,
} from '../lib/supabase';
import { CONFIG } from '../config';
import {
  postCreateOrderV2,
  formatCreateOrderV2Error,
  navigateToPaymentProcessingAfterV2,
} from '../lib/createOrderV2';
import { fetchActivePaymentGateways } from '../lib/paymentGatewaysApi';
import PaymentGatewaySelector from '../components/PaymentGatewaySelector';
import { toAlertMessage } from '../lib/toAlertMessage';
import { getMenu, getLastRememberedCanteen, rememberLastCanteen } from '../lib/menuCache';
import { VIEWS } from '../lib/supabaseViews';
import { useAuth } from '../lib/AuthContext';
import { pxToPercentX, pxToPercentY } from '../utils/percent';
import { appTypography } from '../lib/darkThemeConfig';
import Svg, { Path } from 'react-native-svg';
import { getItemImageSource } from '../lib/itemImage';
import { prepareCheckoutCart } from '../lib/cartCheckout';
import { navigateBackFromCart } from '../lib/navigateHome';
import {
  isNetworkConnectivityFailure,
  MSG_COULD_NOT_FETCH_DATA,
  MSG_PAYMENT_FAILED,
  MSG_POOR_NETWORK,
} from '../lib/orderFlowErrors';
import LoadingButton from '../components/LoadingButton';
import BrandYellowStrip from '../components/BrandYellowStrip';
import {
  CART_MAX_ORDER_TOTAL,
  CART_MAX_ORDER_TOTAL_MESSAGE,
  exceedsMaxOrderTotal,
  resolveTakeawayFeePerItem,
  takeawayChargeForLines,
  getLowStockWarningItems,
  formatLowStockWarningMessages,
} from '../lib/cartRules';
import { pullRefreshControlProps } from '../lib/pullToRefresh';
import {
  getPushReadinessForOrdering,
  registerForPushNotificationsAsync,
} from '../lib/services/notifications';
import { setNotificationsEnabled } from '../lib/settingsCache';
import NotificationService from '../lib/NotificationService';
import {
  formatPhoneDisplay,
  getPhoneFromUser,
  isValidIndianMobile,
  normalizePhoneDigits,
} from '../lib/userPhone';

const createCartStyles = (colors, windowHeight) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.contentBackground,
  },
  topStrip: {
    height: 34,
    backgroundColor: colors.brandYellow,
  },
  orderLimitBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  orderLimitBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: appTypography.semiBold,
    lineHeight: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: colors.elevatedSurface,
  },
  backButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 20,
    fontFamily: appTypography.bold,
    flex: 1,
    marginHorizontal: 16,
  },
  headerClearButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
    flexGrow: 1,
  },
  emptyScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 24,
  },
  cartItemsSection: {
    paddingHorizontal: 16,
    paddingVertical: 0,
    gap: 0,
    marginBottom: 0,
    marginTop: 20,
  },
  quantityImageNote: {
    fontSize: 12,
    fontFamily: appTypography.regular,
    color: colors.textTertiary,
    lineHeight: 18,
    marginTop: 10,
    paddingHorizontal: 2,
  },
  singleCartCard: {
    width: '100%',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  singleCartCardGradient: {
    padding: 14,
  },
  cartItemContainer: {
    paddingVertical: 6,
  },
  itemSeparator: {
    alignSelf: 'center',
    width: '86%',
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    marginVertical: 8,
  },
  cartItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
    paddingVertical: 2,
  },
  cartItemDetailHit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  itemImage: {
    width: 54,
    height: 54,
    borderRadius: 10,
    marginRight: 12,
    resizeMode: 'cover',
  },
  itemDetails: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 2,
  },
  itemName: {
    fontSize: 15,
    fontFamily: appTypography.bold,
    color: colors.text,
    marginBottom: 4,
    numberOfLines: 2,
    ellipsizeMode: 'tail',
    lineHeight: 18,
  },
  itemPrice: {
    fontSize: 17,
    fontFamily: appTypography.bold,
    color: colors.accentGreen,
    lineHeight: 19,
  },
  quantitySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.elevatedSurface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.brandYellow,
    width: 88,
    height: 32,
    paddingHorizontal: 4,
    marginTop: 12,
  },
  quantityButton: {
    width: 26,
    height: 26,
    backgroundColor: colors.elevatedSurface,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  minusLine: {
    width: 9,
    height: 2,
    backgroundColor: colors.text,
    borderRadius: 1,
  },
  quantityText: {
    fontSize: 14,
    fontFamily: appTypography.bold,
    color: colors.text,
    marginHorizontal: 6,
    lineHeight: 18,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  plusText: {
    fontSize: 16,
    fontFamily: appTypography.bold,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 18,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  takeawaySection: {
    marginTop: 15,
  },
  selectOptionLabel: {
    fontSize: 9,
    fontFamily: appTypography.bold,
    color: colors.textTertiary,
    marginBottom: 6,
    marginLeft: -16,
  },
  takeawayOption: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radioButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.textTertiary,
    backgroundColor: colors.elevatedSurface,
    marginRight: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioButtonSelected: {
    borderColor: colors.brandYellow,
    backgroundColor: colors.brandYellow,
  },
  radioButtonInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.elevatedSurface,
  },
  takeawayText: {
    fontSize: 15,
    fontFamily: appTypography.bold,
    color: colors.text,
    marginRight: 5,
  },
  takeawayDescription: {
    fontSize: 10,
    fontFamily: appTypography.regular,
    color: colors.textTertiary,
    marginTop: 4,
    marginLeft: 'auto',
    textAlign: 'right',
    flex: 1,
    flexWrap: 'wrap',
  },
  recommendationsSection: {
    backgroundColor: colors.elevatedSurface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 0,
  },
  recommendationsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  addonsIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  recommendationsTitle: {
    fontSize: 16,
    fontFamily: appTypography.bold,
    color: colors.textTertiary,
    marginLeft: 10,
  },
  recommendationsScroll: {
    paddingLeft: 8,
    paddingRight: 8,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  recommendationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 58,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.elevatedSurface,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  recommendationTapArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    marginRight: 8,
  },
  recommendationImage: {
    width: 36,
    height: 36,
    borderRadius: 6,
  },
  recommendationMeta: {
    flexShrink: 1,
    marginLeft: 8,
    marginRight: 4,
  },
  recommendationName: {
    fontSize: 15,
    fontFamily: appTypography.bold,
    color: colors.text,
    marginBottom: 2,
    maxWidth: 110,
  },
  recommendationPrice: {
    fontSize: 14,
    fontFamily: appTypography.bold,
    color: colors.accentGreen,
  },
  recommendationBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recommendationSkeletonLine: {
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  addButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.brandOrange,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    flexShrink: 0,
  },
  addButtonText: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    color: '#FFFFFF',
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: 'center',
    textAlign: 'center',
  },
  toPaySection: {
    backgroundColor: colors.elevatedSurface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 16,
    marginBottom: 20,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 0,
    overflow: 'hidden',
  },
  toPayTopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  toPayTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  toPayBottomSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clearCartButton: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: colors.dangerTintBackground,
  },
  expandButton: {
    padding: 4,
  },
  toPayContent: {
    flex: 1,
    marginLeft: 0,
  },
  toPayTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toPayLeftColumn: {
    flex: 1,
    minWidth: 0,
  },
  toPayLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toPayLabel: {
    fontSize: 20,
    fontFamily: appTypography.bold,
    color: colors.textTertiary,
  },
  toPaySubtitle: {
    fontSize: 10,
    fontFamily: appTypography.bold,
    color: colors.textMuted,
    marginTop: 2,
  },
  toPaySubtitleAligned: {
    fontSize: 10,
    fontFamily: appTypography.bold,
    color: colors.textMuted,
    marginTop: 2,
    marginLeft: 30, // aligns under "To Pay" text (icon + spacing)
  },
  toPayAmount: {
    fontSize: 20,
    fontFamily: appTypography.bold,
    color: colors.accentGreen,
    marginRight: 12,
  },
  policySection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  policyTitle: {
    fontSize: 12,
    fontFamily: appTypography.bold,
    color: colors.textTertiary,
    marginBottom: 4,
  },
  policyText: {
    fontSize: 12,
    fontFamily: appTypography.bold,
    color: colors.textMuted,
    lineHeight: 15,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.elevatedSurface,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 20,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 4,
  },
  phonePlaceOrderLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  phonePlaceOrderText: {
    flex: 1,
    fontSize: 12,
    fontFamily: appTypography.regular,
  },
  phonePlaceOrderChange: {
    fontSize: 12,
    fontFamily: appTypography.semiBold,
  },
  placeOrderButton: {
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  placeOrderButtonDisabled: {
    opacity: 0.55,
  },
  placeOrderText: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    color: '#FFFFFF',
  },
  emptyCartContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 24,
    minHeight: Math.max(320, Math.round(windowHeight * 0.55)),
  },
  emptyCartBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 24,
  },
  emptyCartCard: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 24,
  },
  emptyCartTitle: {
    fontSize: 24,
    fontFamily: appTypography.bold,
    marginTop: 20,
    marginBottom: 12,
    textAlign: 'center',
    color: colors.text,
  },
  emptyCartSubtitle: {
    fontSize: 16,
    fontFamily: appTypography.regular,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
    color: colors.textSecondary,
  },
  browseButton: {
    backgroundColor: colors.brandOrange,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 200,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: appTypography.bold,
  },
  addMoreItemsHeader: {
    paddingHorizontal: 20,
    alignItems: 'flex-end',
    marginBottom: 20,
    paddingRight: 5,
  },
  addMoreItemsButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  addMoreItemsText: {
    fontSize: 17,
    fontFamily: appTypography.bold,
    color: colors.accentGreen,
  },
  priceBreakdownSection: {
    backgroundColor: colors.elevatedSurface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 20,
    paddingBottom: 0,
    overflow: 'visible',
  },
  priceBreakdownInline: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 0,
    overflow: 'visible',
  },
  priceBreakdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  priceBreakdownItemName: {
    fontSize: 16,
    fontFamily: appTypography.bold,
    color: colors.textTertiary,
    flex: 1,
  },
  priceBreakdownItemPrice: {
    fontSize: 15,
    fontFamily: appTypography.bold,
    color: colors.accentGreen,
    textAlign: 'right',
    flexShrink: 0,
    maxWidth: '56%',
    marginLeft: 8,
  },
  priceBreakdownTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    marginTop: 8,
  },
  priceBreakdownTotalLabel: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    color: colors.textSecondary,
  },
  priceBreakdownTotalAmount: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    color: colors.accentGreen,
  },
  waveContainer: {
    width: 'calc(100% + 40px)',
    height: 55,
    marginTop: 0,
    marginHorizontal: -20,
    marginBottom: -12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  globalTakeawayContainer: {
    backgroundColor: colors.elevatedSurface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
  },
  globalTakeawayToggle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxButton: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.textTertiary,
    backgroundColor: colors.elevatedSurface,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxButtonSelected: {
    borderColor: colors.brandYellow,
    backgroundColor: colors.brandYellow,
  },
  globalTakeawayText: {
    fontSize: 16,
    fontFamily: appTypography.bold,
    color: colors.text,
  },
  globalTakeawayPriceHint: {
    fontSize: 13,
    fontFamily: appTypography.semiBold,
    color: colors.textSecondary,
    marginLeft: 6,
  },
  globalTakeawayDescription: {
    fontSize: 12,
    fontFamily: appTypography.regular,
    color: colors.textTertiary,
    marginTop: 8,
    marginLeft: 30,
  },
  phoneModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  phoneModalCard: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    borderTopWidth: 1,
  },
  phoneModalTitle: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    marginBottom: 6,
  },
  phoneModalBody: {
    fontSize: 13,
    fontFamily: appTypography.regular,
    lineHeight: 18,
    marginBottom: 14,
  },
  phoneModalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: appTypography.regular,
    marginBottom: 8,
  },
  phoneModalError: {
    fontSize: 12,
    fontFamily: appTypography.regular,
    marginBottom: 10,
  },
  phoneModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  phoneModalBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneModalBtnText: {
    fontSize: 15,
    fontFamily: appTypography.semiBold,
  },
});

const CartScreen = ({ navigation }) => {
  const { colors, isDarkMode } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(
    () => createCartStyles(colors, windowHeight),
    [colors, windowHeight]
  );
  const insets = useSafeAreaInsets(); // Get safe area insets for proper spacing
  // Remount body after returning from payment SDK/WebView — Android often leaves
  // ScrollView layout stuck with content pinned under the header.
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setLayoutEpoch((n) => n + 1);
      return undefined;
    }, [])
  );
  const { 
    cartItems, 
    increaseQuantity, 
    decreaseQuantity, 
    getTotalPrice, 
    clearCart,
    addToCart,
    replaceCartItems,
    isTakeaway,
    setIsTakeaway,
    takeawayFeePerItem,
    setTakeawayFeePerItem,
    refreshCart,
  } = useCart();

  const { user, updateUserPhone } = useAuth();
  
  const getTakeawayChargeForLines = (lines) =>
    takeawayChargeForLines(lines, isTakeaway, takeawayFeePerItem);

  const getTakeawayCharge = () => getTakeawayChargeForLines(cartItems);

  const getSubtotalForLines = (lines) =>
    (Array.isArray(lines) ? lines : []).reduce(
      (sum, item) => sum + (item.price || 0) * (item.quantity || 1),
      0
    );

  // Calculate final total with takeaway charge
  const getFinalTotal = () => {
    const subtotal = getTotalPrice();
    return subtotal + getTakeawayCharge();
  };

  const getFinalTotalForLines = (lines) => getSubtotalForLines(lines) + getTakeawayChargeForLines(lines);

  /** To Pay line: `2 × ₹45.00 = ₹90.00` */
  const formatToPayLine = (item) => {
    const qty = Math.max(1, Math.floor(Number(item?.quantity ?? 1)) || 1);
    const unit = Number(item?.price ?? 0);
    const safeUnit = Number.isFinite(unit) ? unit : 0;
    const line = qty * safeUnit;
    return `₹${safeUnit} × ${qty}`;
  };

  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [phoneModalVisible, setPhoneModalVisible] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneModalError, setPhoneModalError] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneRequiredForCheckout, setPhoneRequiredForCheckout] = useState(false);
  const phoneSavedResumeRef = useRef(null);
  const checkoutPhoneRef = useRef('');
  const placeOrderInFlightRef = useRef(false);
  const [checkoutErrorToast, setCheckoutErrorToast] = useState('');
  const [isOrderSummaryExpanded, setIsOrderSummaryExpanded] = useState(false); // State for Order Summary dropdown

  // Sync takeaway fee from AsyncStorage + live canteens.takeaway_charge (matches create_order).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const last = await getLastRememberedCanteen();
        if (!cancelled && last?.takeawayCharge != null) {
          setTakeawayFeePerItem(last.takeawayCharge);
        }
        const canteenId = user?.id
          ? await getUserCanteenId(user.id)
          : last?.id || null;
        if (!canteenId || cancelled) return;
        let feeRaw = null;
        let name = last?.name || '';
        const viewRes = await supabase
          .from(VIEWS.ACTIVE_OPEN_CANTEENS)
          .select('takeaway_charge, name')
          .eq('id', canteenId)
          .maybeSingle();
        if (!viewRes.error && viewRes.data?.takeaway_charge != null) {
          feeRaw = viewRes.data.takeaway_charge;
          name = viewRes.data.name || name;
        } else {
          const { data } = await supabase
            .from('canteens')
            .select('takeaway_charge, name')
            .eq('id', canteenId)
            .maybeSingle();
          if (data?.takeaway_charge != null) {
            feeRaw = data.takeaway_charge;
            name = data.name || name;
          }
        }
        if (cancelled || feeRaw == null) return;
        const fee = resolveTakeawayFeePerItem(feeRaw);
        setTakeawayFeePerItem(fee);
        rememberLastCanteen(canteenId, name, {
          takeawayCharge: fee,
        }).catch(() => {});
      } catch (_) {}
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, setTakeawayFeePerItem]);

  // Keep a ref so checkout resume after saving phone does not see a stale user.
  useEffect(() => {
    checkoutPhoneRef.current = getPhoneFromUser(user);
  }, [user]);

  // Payment Gateway State Ownership
  const [gateways, setGateways] = useState([]);
  const [gatewayLoading, setGatewayLoading] = useState(true);
  const [gatewayError, setGatewayError] = useState(false);
  const [selectedGateway, setSelectedGateway] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [allFoodItems, setAllFoodItems] = useState([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);

  const loadGateways = useCallback(async () => {
    setGatewayLoading(true);
    const res = await fetchActivePaymentGateways();

    if (!res.success || !res.data) {
      setGatewayError(true);
      setGatewayLoading(false);
      return;
    }

    const activeList = res.data;
    setGateways(activeList);
    setGatewayLoading(false);

    if (activeList.length === 0) {
      setGatewayError(true);
      return;
    }

    setGatewayError(false);
    setSelectedGateway((prev) => {
      if (prev && activeList.some((g) => g.code === prev)) return prev;
      const defaultGw = activeList.find((g) => g.is_default) || activeList[0];
      return defaultGw.code;
    });
  }, []);

  const transformMenuItem = useCallback(
    (item) => ({
      ...item,
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price || 0.0,
      unit_price: item.price || 0.0,
      total_price: (item.price || 0.0) * (item.quantity || 1),
      special_instructions: item.special_instructions || '',
      category: item.categories?.name || 'Other',
      image: item.image_url,
      isAvailable: deriveItemIsAvailable(item),
      isVegetarian: item.is_vegetarian,
      reviews: item.reviews_count,
      ingredients: item.ingredients || [],
      preparation: item.preparation || [],
      cookingTime: item.cooking_time,
      spiceLevel: item.spice_level,
      calories: item.calories,
    }),
    []
  );

  const loadRecommendationMenu = useCallback(
    async ({ forceRefresh = false } = {}) => {
      try {
        setRecommendationsLoading(true);
        const canteenId = user?.id ? await getUserCanteenId(user.id) : null;
        let resolvedCanteenId = canteenId;
        if (!resolvedCanteenId && user?.id) {
          try {
            const last = await getLastRememberedCanteen();
            if (last?.id) resolvedCanteenId = last.id;
          } catch (_) {}
        }
        const { data, error } = await getMenu(resolvedCanteenId, {
          forceRefresh,
          onUpdate: (fresh) => {
            if (!Array.isArray(fresh)) return;
            setAllFoodItems(fresh.map(transformMenuItem));
          },
        });
        if (error) {
          console.error('Error fetching food items for recommendations:', error);
        } else if (Array.isArray(data)) {
          setAllFoodItems(data.map(transformMenuItem));
        }
      } catch (error) {
        console.error('Error fetching food items:', error);
      } finally {
        setRecommendationsLoading(false);
      }
    },
    [user?.id, transformMenuItem]
  );

  useEffect(() => {
    loadGateways();
  }, [loadGateways]);

  useEffect(() => {
    loadRecommendationMenu();
  }, [loadRecommendationMenu]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        typeof refreshCart === 'function' ? refreshCart() : Promise.resolve(),
        loadGateways(),
        loadRecommendationMenu({ forceRefresh: true }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshCart, loadGateways, loadRecommendationMenu]);

  const canProceedCheckout = !gatewayLoading && !gatewayError && selectedGateway != null;

  const subtotalAmount = getTotalPrice();
  const orderOverLimit = exceedsMaxOrderTotal(subtotalAmount);

  const lowStockBannerMessages = useMemo(
    () => formatLowStockWarningMessages(getLowStockWarningItems(cartItems)),
    [cartItems]
  );

  const handleTakeawayToggle = () => {
    if (isTakeaway) {
      setIsTakeaway(false);
      return;
    }
    setIsTakeaway(true);
  };

  // Get authenticated user ID (required by RLS policies)
  const getUserId = () => user?.id;

  const savedPhone = useMemo(() => getPhoneFromUser(user), [user]);

  const openPhoneModal = useCallback(
    (opts = {}) => {
      setPhoneDraft(savedPhone || '');
      setPhoneModalError('');
      setPhoneRequiredForCheckout(Boolean(opts.required));
      setPhoneModalVisible(true);
    },
    [savedPhone]
  );

  const closePhoneModal = useCallback(() => {
    if (phoneSaving) return;
    setPhoneModalVisible(false);
    setPhoneRequiredForCheckout(false);
    phoneSavedResumeRef.current = null;
  }, [phoneSaving]);

  const savePhoneFromModal = useCallback(async () => {
    if (!isValidIndianMobile(phoneDraft)) {
      setPhoneModalError('Enter a valid 10-digit mobile number (starts with 6–9).');
      return;
    }
    setPhoneSaving(true);
    setPhoneModalError('');
    try {
      const result = await updateUserPhone(phoneDraft);
      if (!result?.ok) {
        setPhoneModalError(result?.error || 'Could not save phone number.');
        return;
      }
      checkoutPhoneRef.current =
        result.phone || normalizePhoneDigits(phoneDraft);
      setPhoneModalVisible(false);
      setPhoneRequiredForCheckout(false);
      const resume = phoneSavedResumeRef.current;
      phoneSavedResumeRef.current = null;
      if (typeof resume === 'function') {
        // Defer so modal unmount + setUser settle before checkout re-runs.
        setTimeout(() => resume(), 0);
      }
    } finally {
      setPhoneSaving(false);
    }
  }, [phoneDraft, updateUserPhone]);

  useEffect(() => {
    if (!checkoutErrorToast) return undefined;
    const t = setTimeout(() => setCheckoutErrorToast(''), 5000);
    return () => clearTimeout(t);
  }, [checkoutErrorToast]);

  const addonBeverages = useMemo(() => {
    if (!Array.isArray(allFoodItems) || allFoodItems.length === 0) return [];
    const cartItemIds = new Set((cartItems || []).map((item) => item.id));
    return allFoodItems
      .filter((item) => {
        const category = String(item?.category || '').toLowerCase();
        const name = String(item?.name || '').toLowerCase();
        const isBeverageCategory = category.includes('beverage') || category.includes('drink');
        const isBeverageName =
          name.includes('tea') ||
          name.includes('coffee') ||
          name.includes('juice') ||
          name.includes('shake') ||
          name.includes('water') ||
          name.includes('cola');
        const isAvailable = item?.isAvailable !== false;
        const notInCart = !cartItemIds.has(item.id);
        return (isBeverageCategory || isBeverageName) && isAvailable && notInCart;
      })
      .slice(0, 6);
  }, [allFoodItems, cartItems]);
  
  // Debug logging (disabled for performance)
  // console.log('🔍 Cart Debug Info:', { cartItems: cartItems.length, allFoodItems: allFoodItems.length, recommendations: recommendations.length });

  const handleClearCart = () => {
    Alert.alert(
      'Clear Cart',
      'Are you sure you want to clear your cart?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clearCart },
      ]
    );
  };

  const handlePayment = async () => {
    if (cartItems.length === 0) {
      Alert.alert('Empty Cart', 'Please add some items to your cart first.');
      return;
    }
    if (exceedsMaxOrderTotal(getTotalPrice())) {
      Alert.alert('Order limit', CART_MAX_ORDER_TOTAL_MESSAGE);
      return;
    }
    if (placeOrderInFlightRef.current || isCreatingOrder) return;
    if (!CONFIG.CREATE_ORDER_V2_URL) {
      Alert.alert(
        'Checkout Unavailable',
        'Online payment is not available right now. Please try again later or contact support.'
      );
      return;
    }

    placeOrderInFlightRef.current = true;
    setIsCreatingOrder(true);
    setCheckoutErrorToast('');

    try {
      const userId = getUserId();
      if (!userId) {
        Alert.alert('Authentication Required', 'Please sign in to place an order.');
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        Alert.alert('Error', 'User session not found. Please login again.');
        return;
      }

      // Gateways need a phone; store on auth metadata (edge reads it later).
      const checkoutPhone =
        checkoutPhoneRef.current || getPhoneFromUser(user);
      if (!isValidIndianMobile(checkoutPhone)) {
        placeOrderInFlightRef.current = false;
        setIsCreatingOrder(false);
        phoneSavedResumeRef.current = () => {
          handlePayment();
        };
        openPhoneModal({ required: true });
        return;
      }

      const prep = await prepareCheckoutCart(userId, cartItems);
      if (prep.stockErrors.length > 0) {
        Alert.alert('Cannot place order', prep.stockErrors.join('\n'));
        return;
      }

      const linesForOrder = prep.cartAfterCanteen;
      if (!linesForOrder.length) {
        Alert.alert('Cart empty', 'No valid items left.');
        return;
      }

      const continueCheckout = async () => {
        const args = prepareCheckoutOrderArgs(linesForOrder, isTakeaway);
        if (!args.ok) {
          Alert.alert('Cannot place order', toAlertMessage(args.error, 'Invalid cart.'));
          return;
        }

        const check = await validateCartItemsForUserCanteen(userId, linesForOrder, args.p_items);
        if (!check.ok) {
          Alert.alert('Cannot place order', toAlertMessage(check.error, 'Cart validation failed.'));
          return;
        }

        const v2 = await postCreateOrderV2({
          accessToken: session.access_token,
          items: args.p_items,
          is_takeaway: args.p_is_takeaway,
          gateway_code: selectedGateway || 'cashfree',
        });

        if (!v2.ok) {
          const detail = formatCreateOrderV2Error(v2.data, v2.status);
          setCheckoutErrorToast(toAlertMessage(v2.error, detail));
          return;
        }

        const orderTotal = getFinalTotalForLines(linesForOrder);
        const nav = await navigateToPaymentProcessingAfterV2(navigation, supabase, v2, {
          userId,
          orderItems: [...linesForOrder],
          orderTotal,
          isTakeaway: args.p_is_takeaway,
        });
        if (!nav.ok) {
          setCheckoutErrorToast(toAlertMessage(nav.error, 'Checkout incomplete.'));
        }
      };

      const runWithOptionalStockWarning = async () => {
        if (prep.stockWarnings.length > 0) {
          placeOrderInFlightRef.current = false;
          setIsCreatingOrder(false);
          Alert.alert(
            'Low stock warning',
            `${prep.stockWarnings.join('\n')}\n\nIf stock runs out after payment, that item may be cancelled and refunded.`,
            [
              { text: 'Go back', style: 'cancel' },
              {
                text: 'Continue',
                onPress: () => {
                  placeOrderInFlightRef.current = true;
                  setIsCreatingOrder(true);
                  continueCheckout()
                    .catch((error) => {
                      const m = typeof error?.message === 'string' ? error.message.trim() : '';
                      if (m === MSG_POOR_NETWORK || isNetworkConnectivityFailure(error)) {
                        setCheckoutErrorToast(MSG_POOR_NETWORK);
                      } else if (m === MSG_COULD_NOT_FETCH_DATA) {
                        setCheckoutErrorToast(MSG_COULD_NOT_FETCH_DATA);
                      } else {
                        console.warn('handlePayment:', error?.message || error);
                        setCheckoutErrorToast(toAlertMessage(error, MSG_PAYMENT_FAILED));
                      }
                    })
                    .finally(() => {
                      placeOrderInFlightRef.current = false;
                      setIsCreatingOrder(false);
                    });
                },
              },
            ]
          );
          return;
        }
        await continueCheckout();
      };

      const pushReady = await getPushReadinessForOrdering(userId);
      if (!pushReady.ready && pushReady.canRegister) {
        placeOrderInFlightRef.current = false;
        setIsCreatingOrder(false);
        Alert.alert(
          'Enable order notifications?',
          'Turn on notifications so you get updates when your order is placed, ready, or refunded.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Not now',
              onPress: () => {
                placeOrderInFlightRef.current = true;
                setIsCreatingOrder(true);
                runWithOptionalStockWarning()
                  .catch((error) => {
                    const m = typeof error?.message === 'string' ? error.message.trim() : '';
                    if (m === MSG_POOR_NETWORK || isNetworkConnectivityFailure(error)) {
                      setCheckoutErrorToast(MSG_POOR_NETWORK);
                    } else if (m === MSG_COULD_NOT_FETCH_DATA) {
                      setCheckoutErrorToast(MSG_COULD_NOT_FETCH_DATA);
                    } else {
                      console.warn('handlePayment:', error?.message || error);
                      setCheckoutErrorToast(toAlertMessage(error, MSG_PAYMENT_FAILED));
                    }
                  })
                  .finally(() => {
                    placeOrderInFlightRef.current = false;
                    setIsCreatingOrder(false);
                  });
              },
            },
            {
              text: 'Enable',
              onPress: () => {
                (async () => {
                  placeOrderInFlightRef.current = true;
                  setIsCreatingOrder(true);
                  try {
                    const result = await registerForPushNotificationsAsync(userId);
                    if (result.token || result.localOnly) {
                      await setNotificationsEnabled(true);
                      NotificationService.isInitialized = false;
                      await NotificationService.initialize();
                    } else if (result.reason === 'permission_denied') {
                      Alert.alert(
                        'Permission needed',
                        'Allow notifications in system settings to get order updates. You can continue checkout without them.'
                      );
                    }
                    await runWithOptionalStockWarning();
                  } catch (error) {
                    const m = typeof error?.message === 'string' ? error.message.trim() : '';
                    if (m === MSG_POOR_NETWORK || isNetworkConnectivityFailure(error)) {
                      setCheckoutErrorToast(MSG_POOR_NETWORK);
                    } else if (m === MSG_COULD_NOT_FETCH_DATA) {
                      setCheckoutErrorToast(MSG_COULD_NOT_FETCH_DATA);
                    } else {
                      console.warn('handlePayment:', error?.message || error);
                      setCheckoutErrorToast(toAlertMessage(error, MSG_PAYMENT_FAILED));
                    }
                  } finally {
                    placeOrderInFlightRef.current = false;
                    setIsCreatingOrder(false);
                  }
                })();
              },
            },
          ]
        );
        return;
      }

      await runWithOptionalStockWarning();
    } catch (error) {
      const m = typeof error?.message === 'string' ? error.message.trim() : '';
      if (m === MSG_POOR_NETWORK || isNetworkConnectivityFailure(error)) {
        setCheckoutErrorToast(MSG_POOR_NETWORK);
      } else if (m === MSG_COULD_NOT_FETCH_DATA) {
        setCheckoutErrorToast(MSG_COULD_NOT_FETCH_DATA);
      } else {
        console.warn('handlePayment:', error?.message || error);
        setCheckoutErrorToast(toAlertMessage(error, MSG_PAYMENT_FAILED));
      }
    } finally {
      placeOrderInFlightRef.current = false;
      setIsCreatingOrder(false);
    }
  };

  const renderCartItem = (item, index) => {
    const quantity = item.quantity || 1;
    const itemImageSource = getItemImageSource(item);
    const itemImageRemote = typeof itemImageSource === 'object' && !!itemImageSource?.uri;
    const isLastItem = index === cartItems.length - 1;
    
    const itemForDetail = {
      ...item,
      image: item.image || item.image_url,
    };

    return (
      <View key={item.id} style={styles.cartItemContainer}>
        <View style={styles.cartItemContent}>
          <TouchableOpacity
            style={styles.cartItemDetailHit}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('ItemDetail', { item: itemForDetail })}
          >
            <Image
              source={itemImageSource}
              style={styles.itemImage}
              resizeMode={itemImageRemote ? 'cover' : 'contain'}
            />
            <View style={styles.itemDetails}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>₹{item.price}</Text>
            </View>
          </TouchableOpacity>
          
          <View style={styles.quantitySelector}>
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() => decreaseQuantity(item.id)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              {quantity === 1 ? (
                <AppIcon name="trash-outline" size={14} color={isDarkMode ? colors.error : '#000000'} />
              ) : (
                <View style={styles.minusLine} />
              )}
            </TouchableOpacity>
            
            <Text style={styles.quantityText}>{quantity}</Text>
            
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() => increaseQuantity(item.id)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <AppIcon name="add" size={16} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Takeaway section removed from item card */}
        
        {!isLastItem && <View style={styles.itemSeparator} />}
      </View>
    );
  };



  const renderRecommendations = () => {
    if (!shouldShowRecommendations(cartItems)) {
      return null;
    }
    if (!recommendationsLoading && addonBeverages.length === 0) {
      return null;
    }

    const skeletonKeys = [0, 1, 2, 3, 4, 5];

    return (
      <View style={styles.recommendationsSection}>
        <View style={styles.recommendationsHeader}>
          <LinearGradient
            colors={[colors.brandYellow, '#D4A017']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.addonsIconBadge}
          >
            <AppIcon name="cafe-outline" size={18} color="#FFFFFF" />
          </LinearGradient>
          <Text style={styles.recommendationsTitle}>Add-ons</Text>
        </View>
        
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recommendationsScroll}
        >
          {recommendationsLoading
            ? skeletonKeys.map((i) => (
                <View key={`addon-skeleton-${i}`} style={styles.recommendationItem}>
                  <View style={[styles.recommendationImage, styles.recommendationSkeletonLine]} />
                  <View style={styles.recommendationMeta}>
                    <View style={[styles.recommendationSkeletonLine, { width: 72, height: 10, marginBottom: 6 }]} />
                    <View style={[styles.recommendationBottomRow, { width: 100 }]}>
                      <View style={[styles.recommendationSkeletonLine, { width: 28, height: 10 }]} />
                      <View style={[styles.recommendationSkeletonLine, { width: 24, height: 24, borderRadius: 6 }]} />
                    </View>
                  </View>
                </View>
              ))
            : addonBeverages.map((item) => {
                const itemForDetail = {
                  ...item,
                  image: item.image || item.image_url,
                };
                const recImageSource = getItemImageSource(item);
                const recImageRemote = typeof recImageSource === 'object' && !!recImageSource?.uri;
                return (
                <View key={item.id} style={styles.recommendationItem}>
                  <TouchableOpacity
                    style={styles.recommendationTapArea}
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('ItemDetail', { item: itemForDetail })}
                  >
                    <Image
                      source={recImageSource}
                      style={styles.recommendationImage}
                      resizeMode={recImageRemote ? 'cover' : 'contain'}
                    />
                    <View style={styles.recommendationMeta}>
                      <Text style={styles.recommendationName} numberOfLines={1}>{item.name}</Text>
                      <View style={styles.recommendationBottomRow}>
                        <Text style={styles.recommendationPrice}>₹{item.price}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => addToCart(item)}
                  >
                    <Text style={styles.addButtonText}>+</Text>
                  </TouchableOpacity>
                </View>
                );
              })}
        </ScrollView>
      </View>
    );
  };

  const renderCartSummary = () => (
    <View style={styles.cartSummary}>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
          Subtotal
        </Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>
          ₹{getTotalPrice()}
        </Text>
      </View>
      
      {isTakeaway && getTakeawayCharge() > 0 && (
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            Takeaway Charge(s)
          </Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>
            ₹{getTakeawayCharge()}
          </Text>
        </View>
      )}
      
      <View style={[styles.summaryDivider, { backgroundColor: colors.divider }]} />
      
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.text, fontFamily: appTypography.semiBold }]}>
          Total
        </Text>
        <Text style={[styles.summaryValue, { color: colors.primary, fontFamily: appTypography.bold }]}>
          ₹{getFinalTotal()}
        </Text>
      </View>
    </View>
  );

  const renderOrderItem = (item) => (
    <View key={item.id} style={styles.orderItem}>
      <View style={styles.itemInfo}>
        <Text style={[styles.orderItemName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.orderItemQuantity, { color: colors.textSecondary }]}>x{item.quantity}</Text>
      </View>
      <Text style={[styles.orderItemPrice, { color: colors.primary }]}>{formatToPayLine(item)}</Text>
    </View>
  );

  const renderEmptyCart = () => (
    <View style={styles.emptyCartBody} accessibilityRole="summary">
      <View style={styles.emptyCartCard}>
        <AppIcon name="cart-outline" size={80} color="#999" />
        <Text style={styles.emptyCartTitle}>
          Your cart is empty
        </Text>
        <Text style={styles.emptyCartSubtitle}>
          Start adding delicious items to your cart
        </Text>
        <TouchableOpacity 
          style={styles.browseButton}
          onPress={() => navigation.navigate('HomeTab')}
        >
          <Text style={styles.browseButtonText}>Browse Menu</Text>
        </TouchableOpacity>
      </View>
    </View>
  );




  return (
    <View style={styles.container}> 
      <BrandYellowStrip />

      <View style={[styles.header, { backgroundColor: colors.elevatedSurface }]}>
        <TouchableOpacity
          onPress={() => navigateBackFromCart(navigation)}
          style={styles.backButton}
        >
          <AppIcon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cart</Text>
        <View style={styles.headerClearButton}>
          {cartItems.length > 0 && (
            <TouchableOpacity onPress={handleClearCart}>
              <AppIcon name="trash-outline" size={24} color={isDarkMode ? colors.error : '#FF9999'} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.separator} />

      {cartItems.length === 0 ? (
        <View key={`empty-cart-${layoutEpoch}`} style={{ flex: 1 }}>
          {renderEmptyCart()}
        </View>
      ) : (
      <ScrollView
        key={`cart-scroll-${layoutEpoch}`}
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            {...pullRefreshControlProps({
              refreshing,
              onRefresh,
              tintColor: colors.primary,
              progressOffset: 0,
              androidBackgroundColor: colors.elevatedSurface,
            })}
          />
        }
      >
        {orderOverLimit ? (
          <View
            style={[
              styles.orderLimitBanner,
              {
                backgroundColor: isDarkMode ? 'rgba(239,68,68,0.15)' : '#FFF1F0',
                borderColor: isDarkMode ? 'rgba(239,68,68,0.45)' : '#FFC9C9',
              },
            ]}
          >
            <AppIcon name="alert-circle-outline" size={20} color={colors.error || '#EF4444'} />
            <Text style={[styles.orderLimitBannerText, { color: colors.error || '#B91C1C' }]}>
              {CART_MAX_ORDER_TOTAL_MESSAGE}
            </Text>
          </View>
        ) : null}

        {!orderOverLimit && lowStockBannerMessages.length > 0 ? (
          <View
            style={[
              styles.orderLimitBanner,
              {
                backgroundColor: isDarkMode ? 'rgba(245,158,11,0.15)' : '#FFF8E8',
                borderColor: isDarkMode ? 'rgba(245,158,11,0.45)' : '#F5D48A',
              },
            ]}
          >
            <AppIcon name="alert-circle-outline" size={20} color="#D97706" />
            <Text style={[styles.orderLimitBannerText, { color: isDarkMode ? '#FBBF24' : '#92400E' }]}>
              {`Low stock: ${lowStockBannerMessages.join(' ')}`}
            </Text>
          </View>
        ) : null}

            {/* Cart Items - Single Card Container */}
            <View style={styles.cartItemsSection}>
              <View style={styles.singleCartCard}>
                <LinearGradient
                  colors={isDarkMode ? ['#000000', '#000000'] : ['#FFE5CB', '#FFFDE8']}
                  style={styles.singleCartCardGradient}
                >
                  {cartItems.map((item, index) => renderCartItem(item, index))}
                </LinearGradient>
              </View>
              <Text style={styles.quantityImageNote}>
                NOTE: The quantity in the image may differ from the original item quantity
              </Text>
            </View>

            {/* Add More Items Text */}
            <View style={styles.addMoreItemsHeader}>
              <TouchableOpacity 
                style={styles.addMoreItemsButton}
                onPress={() => navigation.navigate('HomeTab')}
              >
                <Text style={styles.addMoreItemsText}>+ Add More Items</Text>
              </TouchableOpacity>
            </View>

            {/* Recommendations Section */}
            {renderRecommendations()}

            {/* Global Takeaway Checkbox (above To Pay) */}
            <View style={styles.globalTakeawayContainer}>
              <TouchableOpacity 
                style={styles.globalTakeawayToggle}
                onPress={handleTakeawayToggle}
              >
                <View style={[styles.checkboxButton, isTakeaway && styles.checkboxButtonSelected]}>
                  {isTakeaway && <AppIcon name="checkmark" size={14} color="white" />}
                </View>
                <Text style={styles.globalTakeawayText}>Takeaway</Text>
                <Text style={styles.globalTakeawayPriceHint}>
                  (+₹{takeawayFeePerItem})
                </Text>
                <AppIcon name="basket-outline" size={18} color="#D99367" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
              <Text style={styles.globalTakeawayDescription}>Pick up your order at Canteen Counter</Text>
            </View>

            {/* To Pay Section */}
            <View style={styles.toPaySection}>
              {/* Top header with inline price */}
              <View style={styles.toPayTopHeader}>
                <View style={styles.toPayTopLeft}>
                  <View style={styles.toPayContent}>
                    <View style={styles.toPayTitleRow}>
                      <View style={styles.toPayLeftColumn}>
                        <View style={styles.toPayLabelRow}>
                          <AppIcon
                            name="receipt-outline"
                            size={28}
                            color={colors.text}
                            style={{ marginLeft: -6, marginRight: 8 }}
                          />
                          <Text style={styles.toPayLabel}>To Pay</Text>
                        </View>
                        <Text style={styles.toPaySubtitleAligned}>Pay now & enjoy your food</Text>
                      </View>
                      <Text style={styles.toPayAmount}>₹{getFinalTotal()}</Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity 
                  onPress={() => setIsOrderSummaryExpanded(!isOrderSummaryExpanded)}
                  style={styles.expandButton}
                >
                  <AppIcon 
                    name={isOrderSummaryExpanded ? "chevron-up" : "chevron-down"} 
                    size={24} 
                    color={isDarkMode ? colors.textSecondary : '#646464'} 
                  />
                </TouchableOpacity>
              </View>

              {/* Price Breakdown - inline within same section */}
              {isOrderSummaryExpanded && (
                <View style={styles.priceBreakdownInline}>
                  {cartItems.map((item) => (
                    <View key={item.id} style={styles.priceBreakdownItem}>
                      <Text style={styles.priceBreakdownItemName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.priceBreakdownItemPrice}>{formatToPayLine(item)}</Text>
                    </View>
                  ))}
                  {isTakeaway && getTakeawayCharge() > 0 && (
                    <View style={styles.priceBreakdownItem}>
                      <Text style={styles.priceBreakdownItemName}>Takeaway Charge(s)</Text>
                      <Text style={styles.priceBreakdownItemPrice}>₹{getTakeawayCharge()}</Text>
                    </View>
                  )}
                  <View style={styles.priceBreakdownTotal}>
                    <Text style={styles.priceBreakdownTotalLabel}>Total</Text>
                    <Text style={styles.priceBreakdownTotalAmount}>₹{getFinalTotal()}</Text>
                  </View>
                  
                  {/* Wave SVG Decoration - only when expanded */}
                  <View style={styles.waveContainer}>
                    <Svg width="100%" height="55" viewBox="0 0 360 55" fill="none">
                      <Path 
                        d="M0 55V12.7607C74.5829 73.3865 48.9397 25.0184 52.2675 12.7607C52.2675 12.7607 63.4258 31.1472 85.155 31.1472C106.884 31.1472 112.679 12.7607 133.312 12.7607C153.944 12.7607 160.848 30.5569 181.468 31.1472C203.773 31.7858 218.465 -24.5092 234.323 12.7607C250.181 50.0307 314.191 2.32516 302.447 31.1472C290.703 59.9693 360 12.7607 360 12.7607V55H0Z" 
                        fill={isDarkMode ? '#000000' : '#E2F2FF'}
                      />
                    </Svg>
                  </View>
                </View>
              )}
            </View>

            {/* Payment Gateway Selector */}
            {gatewayLoading ? (
              <ActivityIndicator size="small" style={{ marginVertical: 12 }} color="#E5A93B" />
            ) : gatewayError ? (
              <View style={{ padding: 12, backgroundColor: 'rgba(255,77,77,0.1)', borderRadius: 8, marginVertical: 12 }}>
                <Text style={{ color: '#FF4D4D', fontWeight: '600', fontSize: 13 }}>
                  ⚠️ Payment methods currently unavailable. Please try again later.
                </Text>
              </View>
            ) : (
              <PaymentGatewaySelector
                gateways={gateways}
                selectedGateway={selectedGateway}
                onSelectGateway={setSelectedGateway}
              />
            )}

            {/* Cancellation Policy */}
            <View style={styles.policySection}>
              <Text style={styles.policyTitle}>Cancellation Policy:</Text>
              <Text style={styles.policyText}>
                Orders once placed cannot be cancelled by the customer. In rare cases, the counter may cancel an order.
                Stock is confirmed when payment succeeds. Items with low stock may be cancelled after payment if inventory
                runs out; a refund is issued for those items.
              </Text>
            </View>
      </ScrollView>
      )}

      {/* Bottom Action Bar */}
      {cartItems.length > 0 && (
        <View style={styles.bottomBar}>
          <View style={styles.phonePlaceOrderLine}>
            <Text style={[styles.phonePlaceOrderText, { color: colors.textSecondary }]} numberOfLines={1}>
              {savedPhone
                ? `Mobile ${formatPhoneDisplay(savedPhone)} for payments`
                : 'Mobile number required for payments'}
            </Text>
            <TouchableOpacity
              onPress={() => openPhoneModal({ required: false })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={savedPhone ? 'Change phone number' : 'Add phone number'}
            >
              <Text style={[styles.phonePlaceOrderChange, { color: colors.brandYellow || '#E5A93B' }]}>
                {savedPhone ? 'Change' : 'Add'}
              </Text>
            </TouchableOpacity>
          </View>
          <LoadingButton
            title={
              orderOverLimit
                ? `Over ₹${CART_MAX_ORDER_TOTAL} limit`
                : `Place Order ₹${getFinalTotal()}`
            }
            loadingTitle="Starting checkout..."
            loading={isCreatingOrder}
            onPress={handlePayment}
            disabled={orderOverLimit || !canProceedCheckout}
            style={[styles.placeOrderButton, (orderOverLimit || !canProceedCheckout) && { opacity: 0.55 }]}
            textStyle={styles.placeOrderText}
            indicatorColor="#FFFFFF"
          />
        </View>
      )}
      {checkoutErrorToast ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: (cartItems.length > 0 ? 96 : 24) + 8,
          }}
        >
          <View
            style={{
              paddingVertical: 12,
              paddingHorizontal: 14,
              backgroundColor: isDarkMode ? '#334155' : '#1e293b',
              borderRadius: 12,
            }}
          >
            <Text style={{ color: '#f8fafc', fontSize: 14, lineHeight: 20 }}>{checkoutErrorToast}</Text>
          </View>
        </View>
      ) : null}

      <Modal
        visible={phoneModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closePhoneModal}
      >
        <KeyboardAvoidingView
          style={styles.phoneModalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closePhoneModal} />
          <View
            style={[
              styles.phoneModalCard,
              {
                backgroundColor: colors.elevatedSurface,
                borderColor: colors.border,
                paddingBottom: 28 + (insets?.bottom || 0),
              },
            ]}
          >
            <Text style={[styles.phoneModalTitle, { color: colors.text }]}>
              {phoneRequiredForCheckout ? 'Mobile number required' : 'Mobile for payments'}
            </Text>
            <Text style={[styles.phoneModalBody, { color: colors.textSecondary }]}>
              Payment gateways need your 10-digit mobile number. It is saved to your account so you
              can change it later from the cart.
            </Text>
            <TextInput
              style={[
                styles.phoneModalInput,
                {
                  color: colors.text,
                  backgroundColor: colors.inputBackground,
                  borderColor: phoneModalError ? colors.error : colors.border,
                },
              ]}
              value={phoneDraft}
              onChangeText={(t) => {
                setPhoneDraft(normalizePhoneDigits(t).slice(0, 10));
                if (phoneModalError) setPhoneModalError('');
              }}
              placeholder="10-digit mobile number"
              placeholderTextColor={colors.inputPlaceholder || colors.textTertiary}
              keyboardType="phone-pad"
              maxLength={10}
              autoFocus
              underlineColorAndroid="transparent"
              editable={!phoneSaving}
            />
            {phoneModalError ? (
              <Text style={[styles.phoneModalError, { color: colors.error }]}>{phoneModalError}</Text>
            ) : null}
            <View style={styles.phoneModalActions}>
              {!phoneRequiredForCheckout ? (
                <TouchableOpacity
                  style={[styles.phoneModalBtn, { backgroundColor: colors.mutedRowBackground }]}
                  onPress={closePhoneModal}
                  disabled={phoneSaving}
                >
                  <Text style={[styles.phoneModalBtnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.phoneModalBtn,
                  { backgroundColor: colors.brandYellow || '#E5A93B', opacity: phoneSaving ? 0.7 : 1 },
                ]}
                onPress={savePhoneFromModal}
                disabled={phoneSaving}
              >
                {phoneSaving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[styles.phoneModalBtnText, { color: '#FFFFFF' }]}>
                    {phoneRequiredForCheckout ? 'Save & continue' : 'Save'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};


export default CartScreen;