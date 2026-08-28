import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import AppIcon from '../components/AppIcon';
import BrandYellowStrip from '../components/BrandYellowStrip';
import BottomSnackbar from '../components/BottomSnackbar';
import { useTheme } from '../lib/ThemeContext';
import { useCart } from '../lib/CartContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const { cartItems, addToCart, getItemQuantity, increaseQuantity, decreaseQuantity } = useCart();
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

  const footerPadBottom = Math.max(12, insets.bottom);

  // Add fallback in case item is undefined
  if (!item) {
    return (
      <View style={[styles.container, { backgroundColor: colors.pageBackground }]}>
        <BrandYellowStrip />
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
      </View>
    );
  }

  const itemForCart = { ...item, price: unitPrice };

  const handleAddToCart = async () => {
    if (!item.isAvailable) {
      return; // Don't add to cart if item is out of stock
    }
    // If not in cart, add once; item already in cart, navigate back
    if (cartQuantity === 0) {
      const added = await addToCart(itemForCart);
      if (!added) return;
    }
    // Show snackbar after 200ms
    setTimeout(() => {
      setSnackbarVisible(true);
      if (snackbarHideTimer.current) clearTimeout(snackbarHideTimer.current);
      snackbarHideTimer.current = setTimeout(() => setSnackbarVisible(false), 5000);
    }, 200);
    navigation.goBack();
  };

  const handleIncreaseQuantity = async () => {
    if (!item.isAvailable) return;
    
    if (cartQuantity === 0) {
      // Not in cart yet, add it
      await addToCart(itemForCart);
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
    <View style={[styles.container, { backgroundColor: colors.pageBackground }]}>
      <BrandYellowStrip />

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

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
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
          <Text style={[styles.quantityImageNote, { color: colors.textTertiary }]}>
            NOTE: The quantity in the image may differ from the original item quantity
          </Text>
        </View>
      </ScrollView>

      {/* Fixed Footer */}
      <View style={[styles.footer, { backgroundColor: colors.elevatedSurface, paddingBottom: footerPadBottom }]}>
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
          
          <Text style={[styles.quantityText, { color: colors.text }]}>{displayQuantity}</Text>
          
          <TouchableOpacity
            style={[
              styles.quantityButton,
              { backgroundColor: colors.elevatedSurface },
              !item.isAvailable && styles.quantityButtonDisabled
            ]}
            onPress={handleIncreaseQuantity}
            disabled={!item.isAvailable}
          >
            <AppIcon 
              name="add" 
              size={18} 
              color={!item.isAvailable ? '#999' : colors.text} 
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.addToCartButton,
            { backgroundColor: item.isAvailable ? colors.brandYellow : '#CCC' }
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

      <BottomSnackbar
        visible={snackbarVisible}
        onPressViewCart={() => {
          setSnackbarVisible(false);
          navigation.navigate('CartTab');
        }}
        onHidden={() => {}}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F8',
  },
  topStrip: {
    width: '100%',
  },
  simpleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
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
    fontSize: 20,
    fontFamily: appTypography.bold,
    flex: 1,
  },
  headerSpacer: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  imageContainer: {
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 16,
  },
  imageShadow: {
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  imageCard: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  itemImage: {
    width: '100%',
    height: width * 0.55,
    borderRadius: 18,
  },
  itemInfoContainer: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  itemName: {
    flex: 1,
    fontSize: 22,
    fontFamily: appTypography.bold,
    marginRight: 12,
  },
  priceContainer: {
    alignItems: 'flex-end',
  },
  priceText: {
    fontSize: 22,
    fontFamily: appTypography.bold,
    color: '#00B330',
  },
  itemDescription: {
    fontSize: 15,
    fontFamily: appTypography.regular,
    lineHeight: 22,
  },
  sectionContainer: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: appTypography.bold,
    marginBottom: 12,
  },
  ingredientsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ingredientTag: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  ingredientText: {
    fontSize: 13,
    fontFamily: appTypography.regular,
  },
  quantityImageNote: {
    fontSize: 12,
    fontFamily: appTypography.regular,
    lineHeight: 18,
    marginTop: 14,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
    gap: 12,
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  quantityButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityButtonDisabled: {
    opacity: 0.45,
  },
  minusLine: {
    width: 14,
    height: 2,
    borderRadius: 1,
  },
  minusLineDisabled: {
    opacity: 0.45,
  },
  quantityText: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 16,
    fontFamily: appTypography.bold,
  },
  addToCartButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  cartIcon: {
    marginRight: 8,
  },
  addToCartText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: appTypography.bold,
  },
  addToCartTextDisabled: {
    color: '#999',
  },
  priceInButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: appTypography.bold,
  },
});

export default ItemDetailScreen;
