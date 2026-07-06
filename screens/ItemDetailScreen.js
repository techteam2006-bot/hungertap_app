import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import AppIcon from '../components/AppIcon';
import BottomSnackbar from '../components/BottomSnackbar';
import { useTheme } from '../lib/ThemeContext';
import { useCart } from '../lib/CartContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pxToPercentX, pxToPercentY } from '../utils/percent';
import OptimizedImage from '../components/OptimizedImage';
import { appTypography } from '../lib/darkThemeConfig';
import { getItemImageSource } from '../lib/itemImage';
import { deriveItemIsAvailable } from '../lib/supabase';
import {
  formatItemPrice,
  itemLineTotalForDisplay,
  resolveItemUnitPrice,
} from '../lib/itemPrice';

const { width } = Dimensions.get('window');

const ItemDetailScreen = ({ route, navigation }) => {
  const { colors } = useTheme();
  const { cartItems, addToCart, getItemQuantity, increaseQuantity, decreaseQuantity, removeFromCart } = useCart();
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const snackbarHideTimer = React.useRef(null);
  const insets = useSafeAreaInsets();
  const rawItem = route.params?.item;
  const item = rawItem
    ? { ...rawItem, isAvailable: deriveItemIsAvailable(rawItem) }
    : null;
  
  // Use actual cart quantity directly - no local state
  const cartQuantity = getItemQuantity(item?.id);
  const displayQuantity = cartQuantity;

  const cartLine = cartItems.find((row) => row.id === item?.id);
  const unitPrice = resolveItemUnitPrice(cartLine ?? item);
  const unitPriceDisplay = formatItemPrice(unitPrice);
  const buttonLineTotalDisplay = formatItemPrice(
    itemLineTotalForDisplay(unitPrice, cartQuantity)
  );

  const detailImageSource = item ? getItemImageSource(item) : null;
  const detailImageRemote =
    detailImageSource &&
    typeof detailImageSource === 'object' &&
    !!detailImageSource.uri;

  // Add fallback in case item is undefined
  if (!item) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.pageBackground }]}>
        <View style={[styles.simpleHeader, { backgroundColor: colors.elevatedSurface }]}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <AppIcon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Recipe Details</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={{ padding: 24 }}>
          <Text style={[styles.itemName, { color: colors.text }]}>No item data received</Text>
        </View>
      </SafeAreaView>
    );
  }

  const itemForCart = { ...item, price: unitPrice };

  const handleAddToCart = () => {
    if (!item.isAvailable) {
      return; // Don't add to cart if item is out of stock
    }
    // If not in cart, add once; item already in cart, navigate back
    if (cartQuantity === 0) {
      addToCart(itemForCart);
    }
    // Show snackbar after 200ms
    setTimeout(() => {
      setSnackbarVisible(true);
      if (snackbarHideTimer.current) clearTimeout(snackbarHideTimer.current);
      snackbarHideTimer.current = setTimeout(() => setSnackbarVisible(false), 5000);
    }, 200);
    navigation.goBack();
  };

  const handleIncreaseQuantity = () => {
    if (!item.isAvailable) return;
    
    if (cartQuantity === 0) {
      // Not in cart yet, add it
      addToCart(itemForCart);
    } else {
      // Already in cart, increase quantity
      increaseQuantity(item.id);
    }
  };

  const handleDecreaseQuantity = () => {
    if (cartQuantity > 0) {
      decreaseQuantity(item.id);
    }
  };

  // Use original item ingredients or fallback
  const ingredients = item?.ingredients || [
    'Fresh ingredients', 'Premium quality', 'Handpicked', 'Organic', 'Natural flavors'
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.pageBackground }]}>
      {/* Top strip from home screen */}
      <View style={[styles.topWhiteStrip, { backgroundColor: colors.brandYellow }]} />
      
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.headerWrapper}>
          <View style={[styles.simpleHeader, { backgroundColor: colors.elevatedSurface }]}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backButton}
            >
              <AppIcon name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Recipe Details</Text>
            <View style={styles.headerSpacer} />
          </View>
        </View>
        {/* Item Image */}
        <View style={styles.imageContainer}>
          <View style={styles.imageShadow}>
            <View style={[styles.imageCard, { backgroundColor: colors.elevatedSurface }]}>
              <OptimizedImage
                source={detailImageSource}
                style={styles.itemImage}
                resizeMode={detailImageRemote ? 'cover' : 'contain'}
                priority="high"
                fallbackIcon="restaurant"
              />
            </View>
          </View>
        </View>

        {/* Item Information */}
        <View style={styles.itemInfoContainer}>
          <View style={styles.titleRow}>
            <Text style={[styles.itemName, { color: colors.text }]}>{item.name}</Text>
            <View style={styles.priceContainer}>
              <Text style={styles.priceText}>₹{unitPriceDisplay}</Text>
            </View>
          </View>
          <Text style={[styles.itemDescription, { color: colors.textTertiary }]}>
            {item?.description || 'Delicious and flavorful dish made with premium ingredients'}
          </Text>
        </View>

        {/* Ingredients Section */}
        <View style={[styles.sectionContainer, { backgroundColor: colors.elevatedSurface }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Ingredients</Text>
          <View style={styles.ingredientsGrid}>
            {ingredients.map((ingredient, index) => (
              <View key={index} style={[styles.ingredientTag, { borderColor: colors.border }]}>
                <Text style={[styles.ingredientText, { color: colors.textSecondary }]}>{ingredient}</Text>
              </View>
            ))}
          </View>
        </View>

      </ScrollView>

      {/* Fixed Footer */}
      <View style={[styles.footer, { backgroundColor: colors.elevatedSurface, paddingBottom: Math.max(20, insets.bottom + 10) }]}>
        <View
          style={[
            styles.quantityContainer,
            {
              backgroundColor: colors.quantityStripBackground,
              borderWidth: 1,
              borderColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.quantityButton,
              { backgroundColor: colors.elevatedSurface },
              (!item.isAvailable || cartQuantity === 0) && styles.quantityButtonDisabled
            ]}
            onPress={handleDecreaseQuantity}
            disabled={!item.isAvailable || cartQuantity === 0}
          >
            {cartQuantity === 1 ? (
              <AppIcon 
                name="trash-outline" 
                size={18} 
                color={!item.isAvailable ? '#999' : colors.text} 
              />
            ) : (
              <View style={[
                styles.minusLine,
                { backgroundColor: colors.text },
                (!item.isAvailable || cartQuantity === 0) && styles.minusLineDisabled
              ]} />
            )}
          </TouchableOpacity>
          <Text style={[
            styles.quantityText,
            { color: colors.text },
            !item.isAvailable && styles.quantityTextDisabled
          ]}>{displayQuantity}</Text>
          <TouchableOpacity
            style={[
              styles.quantityButton,
              { backgroundColor: colors.elevatedSurface },
              !item.isAvailable && styles.quantityButtonDisabled
            ]}
            onPress={handleIncreaseQuantity}
            disabled={!item.isAvailable}
          >
            <Text style={[
              styles.plusText,
              { color: colors.text },
              !item.isAvailable && styles.plusTextDisabled
            ]}>+</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={[
            styles.addToCartButton, 
            !item.isAvailable && styles.addToCartButtonDisabled
          ]} 
          onPress={handleAddToCart}
          disabled={!item.isAvailable}
        >
          <AppIcon 
            name="cart" 
            size={20} 
            color={item.isAvailable ? "white" : "#999"} 
            style={styles.cartIcon} 
          />
          <Text style={[
            styles.addToCartText,
            !item.isAvailable && styles.addToCartTextDisabled
          ]}>
            {item.isAvailable ? 'Add to Cart    -  ' : 'Out of Stock'}
          </Text>
          {item.isAvailable && (
            <Text style={styles.priceInButtonText}>₹{buttonLineTotalDisplay}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F8',
  },
  topWhiteStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 34,
    backgroundColor: '#f5bc3b',
    zIndex: 1000,
  },
  headerWrapper: {
    marginTop: pxToPercentY(190), // Account for top strip + extra margin
  },
  simpleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'white',
  },
  backButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    textAlign: 'center',
    color: '#4D4D4D',
    fontSize: 22,
    fontWeight: '800',
    flex: 1,
  },
  headerSpacer: {
    width: 32, // Same width as back button to center the title
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  imageContainer: {
    paddingHorizontal: pxToPercentX(48),
    marginBottom: pxToPercentY(140),
    marginTop: pxToPercentY(60),
  },
  imageShadow: {
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
  },
  imageCard: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  itemImage: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  itemInfoContainer: {
    paddingHorizontal: pxToPercentX(48),
    marginBottom: pxToPercentY(40),
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: pxToPercentY(8),
  },
  itemName: {
    color: 'black',
    fontSize: 24,
    fontFamily: appTypography.bold,
    flex: 1,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priceText: {
    color: '#00B330',
    fontSize: 24,
    fontFamily: appTypography.bold,
  },
  itemDescription: {
    color: '#8B8B8B',
    fontSize: 13,
    fontFamily: appTypography.semiBold,
    lineHeight: 22,
  },
  sectionContainer: {
    marginHorizontal: pxToPercentX(48),
    marginTop: pxToPercentY(80),
    marginBottom: pxToPercentY(10),
    backgroundColor: 'white',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 22,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
  sectionTitle: {
    color: 'black',
    fontSize: 17,
    fontFamily: appTypography.bold,
    marginBottom: pxToPercentY(16),
  },
  ingredientsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  ingredientTag: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.18)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 10,
    marginBottom: 10,
  },
  ingredientText: {
    color: '#3A3A3A',
    fontSize: 12,
    fontFamily: appTypography.bold,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 20,
    backgroundColor: 'white',
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 4,
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(235, 236, 255, 0.47)',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 5,
    marginRight: pxToPercentX(20),
  },
  quantityButton: {
    width: 32,
    height: 32,
    backgroundColor: 'white',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  minusLine: {
    width: 12,
    height: 2,
    backgroundColor: 'black',
  },
  quantityText: {
    color: 'black',
    fontSize: 24,
    fontFamily: appTypography.semiBold,
    marginHorizontal: 20,
  },
  plusText: {
    color: 'black',
    fontSize: 24,
    fontFamily: appTypography.regular,
  },
  addToCartButton: {
    flex: 1,
    backgroundColor: '#F5BC3B',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  cartIcon: {
    marginRight: pxToPercentX(8),
  },
  addToCartText: {
    color: 'white',
    fontSize: 15,
    fontFamily: appTypography.semiBold,
  },
  priceInButtonText: {
    color: 'white',
    fontSize: 15,
    fontFamily: appTypography.semiBold,
  },
  addToCartButtonDisabled: {
    backgroundColor: '#ccc',
  },
  addToCartTextDisabled: {
    color: '#999',
  },
  quantityButtonDisabled: {
    backgroundColor: '#f0f0f0',
  },
  minusLineDisabled: {
    backgroundColor: '#999',
  },
  quantityTextDisabled: {
    color: '#999',
  },
  plusTextDisabled: {
    color: '#999',
  },
});

export default ItemDetailScreen;