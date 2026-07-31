import React, { useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  TextInput,
  ScrollView,
  PanGestureHandler,
  State,
  RefreshControl,
  Image,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AppIcon from './AppIcon';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';
import { pxToPercentX, pxToPercentY } from '../utils/percent';
import { getFontStyle } from '../lib/utils/fonts';
import OptimizedImage from './OptimizedImage';
import { getItemImageSource } from '../lib/itemImage';

const { width, height } = Dimensions.get('window');

// Modern Glassmorphism Card Component
export const GlassCard = ({ children, style, blurIntensity = 10, ...props }) => {
  const { colors } = useTheme();
  
  return (
    <View
      style={[
        styles.glassCard,
        {
          backgroundColor: colors.glassCard,
          borderColor: colors.glassBorder,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
};

// Gradient Button Component
export const GradientButton = ({ 
  title, 
  onPress, 
  gradient = 'primary', 
  size = 'medium',
  icon,
  disabled = false,
  style,
  titleStyle,
  ...props 
}) => {
  const { colors } = useTheme();
  
  const getGradientColors = () => {
    switch (gradient) {
      case 'primary':
        return colors.buttonPrimaryGradient;
      case 'secondary':
        return colors.buttonSecondaryGradient;
      case 'accent':
        return colors.buttonAccentGradient;
      case 'success':
        return colors.successGradient;
      case 'warning':
        return colors.warningGradient;
      case 'error':
        return colors.errorGradient;
      default:
        return colors.buttonPrimaryGradient;
    }
  };

  const getButtonSize = () => {
    switch (size) {
      case 'small':
        return styles.buttonSmall;
      case 'large':
        return styles.buttonLarge;
      default:
        return styles.buttonMedium;
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[getButtonSize(), style]}
      activeOpacity={0.8}
      {...props}
    >
      <LinearGradient
        colors={disabled ? [colors.buttonDisabled, colors.buttonDisabled] : getGradientColors()}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientContainer}
      >
        {icon && (
          <AppIcon 
            name={icon} 
            size={size === 'small' ? 16 : size === 'large' ? 24 : 20} 
            color="#FFFFFF" 
            style={styles.buttonIcon}
          />
        )}
        <Text style={[
          styles.buttonText,
          { fontSize: size === 'small' ? 14 : size === 'large' ? 18 : 16 },
          titleStyle
        ]}>
          {title}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
};

// Modern Category Chip Component
export const CategoryChip = ({ 
  category, 
  isSelected, 
  onPress, 
  style 
}) => {
  const { colors } = useTheme();
  const categoryColor = colors.categoryColors[category] || colors.primary;
  
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.categoryChip,
        {
          backgroundColor: isSelected ? categoryColor : colors.glassCard,
          borderColor: isSelected ? categoryColor : colors.glassBorder,
        },
        style,
      ]}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.categoryText,
          isSelected
            ? { ...getFontStyle('semiBold'), color: '#FFFFFF' }
            : { ...getFontStyle('medium'), color: colors.textSecondary },
        ]}
      >
        {category}
      </Text>
    </TouchableOpacity>
  );
};

// Animated Food Card Component (stable scale ref so cart updates do not reset layout/animation)
export const AnimatedFoodCard = ({ 
  item, 
  onPress, 
  onAddToCart,
  quantity = 0,
  onIncrease,
  onDecrease,
  vegMode = false,
  /** @type {'high'|'normal'|'low'} List rows should use normal/low to stagger image prefetch off the critical path. */
  imagePriority = 'high',
  style
}) => {
  const { colors } = useTheme();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const cardFill = vegMode ? colors.foodCardVegFill : colors.foodCardNeutralFill;
  const cardOutline = {
    borderWidth: 1,
    borderColor: colors.itemCardOutline,
  };

  const nameLower = String(item?.name || '').toLowerCase();
  const dietaryType = (() => {
    if (item?.dietary_type === 'egg') return 'egg';
    return item?.isVegetarian === true ? 'veg' : 'nonveg';
  })();

  const dietaryColors = (() => {
    switch (dietaryType) {
      case 'veg':
        return { accent: '#6DDC8D' };
      case 'egg':
        return { accent: '#FFD27A' };
      default:
        return { accent: '#FF7A7A' };
    }
  })();

  const newCardImageSource = item?.localImage ?? getItemImageSource(item);
  const newCardImageRemote = typeof newCardImageSource === 'object' && !!newCardImageSource?.uri;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.newFoodCard,
        cardOutline,
        {
          transform: [{ scale: scaleAnim }],
        },
        style,
      ]}
    >
      <LinearGradient
        colors={cardFill}
        locations={[0.51, 1.0]}
        style={styles.newFoodCardTouchable}
      >
        {/* Image only — name/description/add controls do not open item detail */}
        <TouchableOpacity
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={0.9}
          style={styles.newFoodImageContainer}
          accessibilityRole="button"
          accessibilityLabel={`View ${item?.name || 'item'} details`}
        >
          <OptimizedImage
            source={newCardImageSource}
            style={[
              styles.newFoodImage,
              !item?.isAvailable ? { opacity: 0.4 } : null,
            ]}
            resizeMode={newCardImageRemote ? 'cover' : 'contain'}
            priority={imagePriority}
            showLoadingIndicator={imagePriority !== 'high'}
            fallbackIcon="restaurant"
          />

          <View style={[styles.dietaryBadge, { borderColor: colors.itemCardOutline }]} pointerEvents="none">
            <View
              style={[
                styles.dietarySquare,
                { borderColor: dietaryColors.accent }
              ]}
            >
              <View
                style={[
                  styles.dietaryDot,
                  { backgroundColor: dietaryColors.accent }
                ]}
              />
            </View>
          </View>

          {!item?.isAvailable && (
            <View style={styles.outOfStockOverlay} pointerEvents="none">
              <Text style={styles.outOfStockText}>OUT OF STOCK</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.newFoodMeta} pointerEvents="box-none">
          <View style={styles.newFoodNamePriceRow} pointerEvents="none">
            <Text
              style={[styles.newFoodName, { color: colors.text }]}
              textBreakStrategy="highQuality"
              android_hyphenationFrequency="none"
            >
              {item?.name || 'Food Item'}
            </Text>
            <View style={styles.newPriceContainer}>
              <Text style={[styles.newCurrencySymbol, { color: colors.text }]}>₹</Text>
              <Text style={[styles.newPrice, { color: colors.text }]}>{item?.price || '0'}</Text>
            </View>
          </View>

          <View style={styles.newDescActionRow}>
            <Text
              style={[styles.newFoodDescription, { color: colors.textTertiary }]}
              numberOfLines={2}
              textBreakStrategy="highQuality"
              android_hyphenationFrequency="none"
              pointerEvents="none"
            >
              {item?.description || 'Delicious food item'}
            </Text>

            {quantity > 0 ? (
              <View
                style={[
                  styles.newQuantityContainer,
                  {
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                  },
                ]}
              >
                <TouchableOpacity
                  style={styles.newQuantityButton}
                  onPress={() => onDecrease && onDecrease()}
                  disabled={!onDecrease}
                >
                  <AppIcon
                    name={quantity === 1 ? 'trash-outline' : 'remove'}
                    size={18}
                    color={quantity === 1 ? '#EF4444' : colors.textSecondary}
                  />
                </TouchableOpacity>
                <Text style={[styles.newQuantityText, { color: colors.text }]}>{quantity}</Text>
                <TouchableOpacity
                  style={styles.newQuantityButton}
                  onPress={() => onIncrease && onIncrease()}
                  disabled={!onIncrease}
                >
                  <AppIcon name="add" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.newAddButton,
                  { backgroundColor: vegMode ? '#00BD32' : colors.brandYellow },
                ]}
                onPress={() => onAddToCart && onAddToCart()}
                disabled={!item?.isAvailable}
              >
                <Text style={[styles.newAddButtonText, { color: '#000000' }]}>+ Add Items</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </LinearGradient>
    </Animated.View>
  );
};

// Modern Search Bar Component
export const ModernSearchBar = ({ 
  placeholder, 
  value, 
  onChangeText, 
  onSubmit, 
  style 
}) => {
  const { colors } = useTheme();
  
  return (
    <View style={[styles.searchBarContainer, style]}>
      <View style={[
        styles.searchBar,
        {
          backgroundColor: colors.glassSurface,
          borderColor: colors.glassBorder,
        },
      ]}>
        <AppIcon name="search" size={20} color={colors.textTertiary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
          blurOnSubmit={false}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="never"
          enablesReturnKeyAutomatically={true}
        />
        {value ? (
          <TouchableOpacity onPress={() => onChangeText('')} style={styles.clearButton}>
            <AppIcon name="close-circle" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

// Loading Shimmer Component
export const LoadingShimmer = ({ style }) => {
  const { colors } = useTheme();
  
  return (
    <View style={[
      styles.shimmerContainer,
      { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
      style
    ]}>
      <View style={[
        styles.shimmer,
        { backgroundColor: colors.border }
      ]} />
    </View>
  );
};

// Modern Header Component
export const ModernHeader = ({ 
  title, 
  subtitle, 
  leftIcon, 
  rightIcon, 
  onLeftPress, 
  onRightPress,
  style,
  titleStyle,
  subtitleStyle,
  rightButtonStyle,
  rightIconColor,
  logo, // New prop for logo image
  logoStyle, // Style for logo
}) => {
  const { colors } = useTheme();
  
  return (
    <View style={[styles.header, style]}>
      <View style={styles.headerLeft}>
        {leftIcon && (
          <TouchableOpacity onPress={onLeftPress} style={styles.headerButton}>
            <AppIcon name={leftIcon} size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <View style={styles.headerTextContainer}>
          {logo ? (
            <Image 
              source={logo} 
              style={[styles.headerLogo, logoStyle]} 
              resizeMode="contain"
            />
          ) : (
            <Text style={[styles.headerTitle, { color: colors.text }, titleStyle]}>{title}</Text>
          )}
          {subtitle && (
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }, subtitleStyle]}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>
      
      {rightIcon && (
        <TouchableOpacity onPress={onRightPress} style={[styles.headerButton, rightButtonStyle]}>
          <AppIcon name={rightIcon} size={24} color={rightIconColor || colors.text} />
        </TouchableOpacity>
      )}
    </View>
  );
};

// Floating Action Button Component
export const FloatingActionButton = ({ 
  icon, 
  onPress, 
  size = 'normal',
  color = 'primary',
  style 
}) => {
  const { colors } = useTheme();
  const scaleAnim = new Animated.Value(1);
  
  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const getButtonSize = () => {
    switch (size) {
      case 'small':
        return 48;
      case 'large':
        return 72;
      default:
        return 56;
    }
  };

  const getIconSize = () => {
    switch (size) {
      case 'small':
        return 20;
      case 'large':
        return 32;
      default:
        return 24;
    }
  };

  return (
    <Animated.View
      style={[
        styles.fab,
        {
          width: getButtonSize(),
          height: getButtonSize(),
          transform: [{ scale: scaleAnim }],
        },
        style,
      ]}
    >
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.8}
        style={styles.fabTouchable}
      >
        <LinearGradient
          colors={colors.buttonPrimaryGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fabGradient}
        >
          <AppIcon name={icon} size={getIconSize()} color="#FFFFFF" />
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Modern Progress Bar Component
export const ModernProgressBar = ({ 
  progress, 
  height = 8, 
  color = 'primary',
  showLabel = false,
  style 
}) => {
  const { colors } = useTheme();
  
  const getProgressColor = () => {
    switch (color) {
      case 'primary':
        return colors.primary;
      case 'success':
        return colors.success;
      case 'warning':
        return colors.warning;
      case 'error':
        return colors.error;
      default:
        return colors.primary;
    }
  };

  return (
    <View style={[styles.progressContainer, { height }, style]}>
      <View style={[styles.progressBackground, { backgroundColor: colors.glassCard }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              width: `${progress}%`,
              backgroundColor: getProgressColor(),
            },
          ]}
        />
      </View>
      {showLabel && (
        <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
          {progress}%
        </Text>
      )}
    </View>
  );
};

// Modern Toggle Switch Component
export const ModernToggleSwitch = ({ 
  value, 
  onValueChange, 
  disabled = false,
  size = 'normal',
  style 
}) => {
  const { colors } = useTheme();
  const translateX = new Animated.Value(value ? 1 : 0);
  
  const toggleSwitch = () => {
    if (disabled) return;
    
    const newValue = !value;
    onValueChange(newValue);
    
    Animated.spring(translateX, {
      toValue: newValue ? 1 : 0,
      useNativeDriver: true,
    }).start();
  };

  const getSwitchSize = () => {
    switch (size) {
      case 'small':
        return { width: 40, height: 24, thumbSize: 18 };
      case 'large':
        return { width: 60, height: 36, thumbSize: 28 };
      default:
        return { width: 50, height: 30, thumbSize: 22 };
    }
  };

  const switchSize = getSwitchSize();

  return (
    <TouchableOpacity
      onPress={toggleSwitch}
      disabled={disabled}
      style={[
        styles.toggleContainer,
        {
          width: switchSize.width,
          height: switchSize.height,
          backgroundColor: value ? colors.primary : colors.glassCard,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
      activeOpacity={0.8}
    >
      <Animated.View
        style={[
          styles.toggleThumb,
          {
            width: switchSize.thumbSize,
            height: switchSize.thumbSize,
            transform: [
              {
                translateX: translateX.interpolate({
                  inputRange: [0, 1],
                  outputRange: [2, switchSize.width - switchSize.thumbSize - 2],
                  extrapolate: 'clamp',
                }),
              },
            ],
            backgroundColor: '#FFFFFF',
          },
        ]}
      />
    </TouchableOpacity>
  );
};

// Enhanced Animated Food Card with Swipe Actions
export const SwipeableFoodCard = ({ 
  item, 
  onPress, 
  onAddToCart,
  onFavorite,
  onDelete,
  style 
}) => {
  const { colors } = useTheme();
  const translateX = new Animated.Value(0);
  const scaleAnim = new Animated.Value(1);
  const swipeImageSource = getItemImageSource(item);
  const swipeImageRemote = typeof swipeImageSource === 'object' && !!swipeImageSource?.uri;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const handleSwipe = (direction) => {
    if (direction === 'left' && onFavorite) {
      onFavorite(item);
    } else if (direction === 'right' && onDelete) {
      onDelete(item);
    }
    
    // Reset position
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.swipeableFoodCard,
        {
          transform: [
            { translateX },
            { scale: scaleAnim },
          ],
        },
        style,
      ]}
    >
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
        style={styles.foodCardTouchable}
      >
        <View style={styles.foodImageContainer}>
          <Animated.Image
            source={swipeImageSource}
            style={styles.foodImage}
            resizeMode={swipeImageRemote ? 'cover' : 'contain'}
          />
          
          {/* Category Badge */}
          <View style={[
            styles.categoryBadge,
            { backgroundColor: colors.categoryColors[item.category] || colors.primary }
          ]}>
            <Text style={styles.categoryBadgeText}>{item.category}</Text>
          </View>
          
          {/* Vegetarian Badge */}
          {item.isVegetarian && (
            <View style={[styles.vegBadge, { backgroundColor: colors.success }]}>
              <Text style={styles.vegBadgeText}>🥬</Text>
            </View>
          )}

          {/* Favorite Button */}
          <TouchableOpacity
            onPress={() => onFavorite && onFavorite(item)}
            style={[
              styles.favoriteButton,
              { backgroundColor: colors.glassCard }
            ]}
          >
            <AppIcon 
              name={item.isFavorite ? "heart" : "heart-outline"} 
              size={20} 
              color={item.isFavorite ? colors.error : colors.textSecondary} 
            />
          </TouchableOpacity>
        </View>

        <View style={styles.foodCardContent}>
          <Text style={[styles.foodName, { color: colors.text }]} numberOfLines={2}>
            {item.name}
          </Text>
          
          <Text style={[styles.foodDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.description}
          </Text>
          
          <View style={styles.foodCardFooter}>
            <View style={styles.priceContainer}>
              <Text style={[styles.price, { color: colors.primary }]}>
                ₹{item.price}
              </Text>
            </View>
            
            <GradientButton
              title="Add"
              onPress={onAddToCart}
              size="small"
              icon="add"
              style={styles.addButton}
            />
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Modern Bottom Sheet Component
export const ModernBottomSheet = ({ 
  visible, 
  onClose, 
  children, 
  height = '50%',
  style 
}) => {
  const { colors } = useTheme();
  const translateY = new Animated.Value(height === '50%' ? height : 300);
  
  React.useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    } else {
      Animated.spring(translateY, {
        toValue: height === '50%' ? height : 300,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.bottomSheetOverlay}>
      <TouchableOpacity
        style={styles.bottomSheetBackdrop}
        onPress={onClose}
        activeOpacity={1}
      />
      <Animated.View
        style={[
          styles.bottomSheet,
          {
            height: height === '50%' ? '50%' : height,
            transform: [{ translateY }],
            backgroundColor: colors.glassSurface,
            borderColor: colors.glassBorder,
          },
          style,
        ]}
      >
        <View style={styles.bottomSheetHandle} />
        <View style={styles.bottomSheetContent}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
};

// Skeleton Loader Component
export const SkeletonLoader = ({ 
  type = 'card',
  style 
}) => {
  const { colors } = useTheme();
  const shimmerAnim = new Animated.Value(0);
  
  React.useEffect(() => {
    const shimmerAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    shimmerAnimation.start();
    return () => shimmerAnimation.stop();
  }, []);

  const getSkeletonType = () => {
    switch (type) {
      case 'card':
        return styles.skeletonCard;
      case 'text':
        return styles.skeletonText;
      case 'avatar':
        return styles.skeletonAvatar;
      case 'button':
        return styles.skeletonButton;
      default:
        return styles.skeletonCard;
    }
  };

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        getSkeletonType(),
        {
          opacity,
          backgroundColor: colors.border,
        },
        style,
      ]}
    />
  );
};

// Enhanced Category Chip with Animation
export const AnimatedCategoryChip = ({ 
  category, 
  title,
  emoji,
  isSelected, 
  onPress, 
  style,
  delay = 0,
  size = 'medium',
}) => {
  const { colors } = useTheme();
  const scaleAnim = React.useRef(new Animated.Value(0)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;
  const displayLabel = category || title || '';
  const dimension = size === 'large' ? 66 : size === 'small' ? 50 : 62;
  
  React.useEffect(() => {
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 8,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }, delay);

    return () => clearTimeout(timer);
  }, [delay, scaleAnim, opacityAnim]);

  const handlePress = () => {
    Animated.sequence([
        Animated.spring(scaleAnim, {
        toValue: 0.9,
        useNativeDriver: true,
      }),
        Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  };

  const categoryColor = colors.categoryColors[displayLabel] || colors.primary;
  
  return (
    <Animated.View
      style={[
        {
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <TouchableOpacity
        onPress={handlePress}
        style={[styles.categoryCircleContainer, style]}
        activeOpacity={0.7}
      >
        <View
          style={[
            styles.categoryCircle,
            {
              width: dimension,
              height: dimension,
              borderRadius: dimension / 2,
              borderColor: isSelected ? categoryColor : colors.border,
              backgroundColor: colors.surface,
              borderWidth: isSelected ? 2 : 1,
            },
          ]}
        >
          {emoji ? (
            <Text style={[styles.categoryEmoji, { fontSize: size === 'large' ? 28 : size === 'small' ? 20 : 24 }]}>{emoji}</Text>
          ) : (
            <AppIcon name="restaurant" size={size === 'large' ? 24 : size === 'small' ? 18 : 20} color={colors.textSecondary} />
          )}
        </View>
        <Text
          style={[
            styles.categoryLabel,
            isSelected
              ? { ...getFontStyle('bold'), color: '#007AFF' }
              : { ...getFontStyle('semiBold'), color: colors.text },
          ]}
          numberOfLines={1}
        >
          {displayLabel}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Parallax Header Component
export const ParallaxHeader = ({ 
  imageSource, 
  title, 
  subtitle,
  height = 200,
  style 
}) => {
  const { colors } = useTheme();
  const scrollY = new Animated.Value(0);
  
  const headerHeight = scrollY.interpolate({
    inputRange: [0, height],
    outputRange: [height, height * 0.6],
    extrapolate: 'clamp',
  });

  const imageOpacity = scrollY.interpolate({
    inputRange: [0, height * 0.5],
    outputRange: [1, 0.3],
    extrapolate: 'clamp',
  });

  const titleScale = scrollY.interpolate({
    inputRange: [0, height * 0.5],
    outputRange: [1, 0.8],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.parallaxHeader,
        {
          height: headerHeight,
        },
        style,
      ]}
    >
      <Animated.Image
        source={imageSource}
        style={[
          styles.parallaxImage,
          {
            opacity: imageOpacity,
          },
        ]}
        resizeMode="cover"
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.7)']}
        style={styles.parallaxGradient}
      />
      <Animated.View
        style={[
          styles.parallaxContent,
          {
            transform: [{ scale: titleScale }],
          },
        ]}
      >
        <Text style={[styles.parallaxTitle, { color: '#FFFFFF' }]}>{title}</Text>
        {subtitle && (
          <Text style={[styles.parallaxSubtitle, { color: '#FFFFFF' }]}>
            {subtitle}
          </Text>
        )}
      </Animated.View>
    </Animated.View>
  );
};

// Pull to Refresh Component
export const ModernPullToRefresh = ({ 
  refreshing, 
  onRefresh, 
  children,
  style,
  contentContainerStyle,
}) => {
  const { colors } = useTheme();
  
  return (
    <ScrollView
      style={[styles.pullToRefreshContainer, style]}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
          progressBackgroundColor={colors.glassCard}
        />
      }
    >
      {children}
    </ScrollView>
  );
};

// Enhanced Loading Shimmer with Multiple Types
export const EnhancedLoadingShimmer = ({ 
  type = 'list',
  itemCount = 3,
  style 
}) => {
  const { colors } = useTheme();
  
  const renderShimmerItem = (index) => {
    switch (type) {
      case 'list':
        return (
          <View key={index} style={styles.shimmerListItem}>
            <SkeletonLoader type="avatar" style={styles.shimmerAvatar} />
            <View style={styles.shimmerTextContainer}>
              <SkeletonLoader type="text" style={styles.shimmerTitle} />
              <SkeletonLoader type="text" style={styles.shimmerSubtitle} />
            </View>
          </View>
        );
      case 'grid':
        return (
          <View key={index} style={styles.shimmerGridItem}>
            <SkeletonLoader type="card" style={styles.shimmerGridCard} />
            <SkeletonLoader type="text" style={styles.shimmerGridTitle} />
          </View>
        );
      default:
        return <SkeletonLoader key={index} type="card" />;
    }
  };

  return (
    <View style={[styles.enhancedShimmerContainer, style]}>
      {Array.from({ length: itemCount }).map((_, index) => renderShimmerItem(index))}
    </View>
  );
};

const styles = StyleSheet.create({
  // Glass Card Styles
  glassCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    margin: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },

  // Button Styles
  buttonSmall: {
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  buttonMedium: {
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
  },
  buttonLarge: {
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
  },
  gradientContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonIcon: {
    marginRight: pxToPercentX(8),
  },

  // Category Chip Styles
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginHorizontal: 4,
    marginVertical: 4,
  },
  categoryText: {
    fontSize: 14,
  },

  // Food Card Styles
  foodCard: {
    borderRadius: 20,
    marginHorizontal: 8,
    marginVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  
  // New Food Card Styles (matching the image design) - Percentage-based for Poco M4 Pro 4G
  newFoodCard: {
    width: '95%',
    marginHorizontal: '2.5%',
    marginTop: 4,
    marginBottom: 6,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 10,
    overflow: 'hidden',
  },
  newFoodCardTouchable: {
    width: '100%',
    borderRadius: 15,
    overflow: 'hidden',
  },
  newFoodImageContainer: {
    width: '100%',
    height: height * 0.2,
    borderRadius: 15,
    overflow: 'hidden',
    position: 'relative',
  },
  newFoodImage: {
    width: '100%',
    height: '100%',
  },
  newFoodImagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dietaryBadge: {
    position: 'absolute',
    top: pxToPercentY(24),
    right: pxToPercentX(12),
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderWidth: 1,
    shadowColor: 'transparent',
    elevation: 0,
  },
  dietarySquare: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  dietaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  newFoodMeta: {
    paddingHorizontal: pxToPercentX(48.6),
    paddingTop: 8,
    paddingBottom: 10,
  },
  newFoodNamePriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  newFoodName: {
    flex: 1,
    minWidth: 0,
    fontSize: Platform.OS === 'ios' ? Math.max(18, width * 0.052) : width * 0.05,
    ...getFontStyle('bold'),
    lineHeight: Platform.OS === 'ios' ? Math.max(22, width * 0.06) : width * 0.055,
    color: 'black',
    textAlign: 'left',
    flexShrink: 1,
  },
  newPriceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    paddingTop: 2,
  },
  newCurrencySymbol: {
    fontSize: Platform.OS === 'ios' ? Math.max(16, width * 0.048) : width * 0.045,
    ...getFontStyle('bold'),
    lineHeight: Platform.OS === 'ios' ? Math.max(22, width * 0.06) : width * 0.055,
    color: 'black',
    marginRight: width * 0.005,
  },
  newPrice: {
    fontSize: Platform.OS === 'ios' ? Math.max(18, width * 0.05) : width * 0.045,
    ...getFontStyle('bold'),
    lineHeight: Platform.OS === 'ios' ? Math.max(22, width * 0.06) : width * 0.055,
    color: 'black',
  },
  newDescActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: 10,
  },
  newFoodDescription: {
    flex: 1,
    minWidth: 0,
    fontSize: Platform.OS === 'ios' ? Math.max(14, width * 0.036) : width * 0.03,
    ...getFontStyle('medium'),
    lineHeight: Platform.OS === 'ios' ? 20 : width * 0.04,
    color: '#8B8B8B',
    textAlign: 'left',
  },
  newAddButton: {
    flexShrink: 0,
    width: 104,
    height: 38,
    backgroundColor: '#D4A017',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  newAddButtonText: {
    fontSize: Platform.OS === 'ios' ? 14 : 13,
    fontFamily: appTypography.bold,
    lineHeight: 18,
    color: '#000000',
    textAlign: 'center',
  },
  newQuantityContainer: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
    width: 110,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  newQuantityButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  newQuantityText: {
    fontSize: Platform.OS === 'ios' ? 15 : 14,
    fontFamily: appTypography.bold,
    lineHeight: 18,
    color: '#353535',
    marginHorizontal: 4,
    minWidth: 20,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  foodCardTouchable: {
    backgroundColor: 'transparent',
  },
  foodImageContainer: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
  },
  foodImage: {
    width: '100%',
    height: 160,
  },
  outOfStockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  outOfStockText: {
    backgroundColor: 'rgba(220, 53, 69, 0.9)', // Bootstrap-like red
    color: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    fontWeight: '800',
    letterSpacing: 1,
  },
  foodImagePlaceholder: {
    width: '100%',
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodImagePlaceholderLogo: {
    width: 150,
    height: 150,
    opacity: 0.95,
  },
  categoryBadge: {
    position: 'absolute',
    top: pxToPercentY(12),
    left: pxToPercentX(12),
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  categoryBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    ...getFontStyle('semiBold'),
  },
  vegBadge: {
    position: 'absolute',
    top: pxToPercentY(12),
    right: pxToPercentX(12),
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vegBadgeText: {
    fontSize: 12,
  },
  // E-commerce product card info
  productInfo: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nameTextContainer: {
    flex: 1,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: pxToPercentY(6),
  },
  categoryPillText: {
    fontSize: 12,
    ...getFontStyle('semiBold'),
  },
  productName: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: pxToPercentY(8),
  },
  productPrice: {
    fontSize: 20,
    fontWeight: '800',
  },
  productPriceRight: {
    fontSize: 18,
    fontWeight: '800',
    marginLeft: pxToPercentX(8),
  },
  productPriceUnder: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: pxToPercentY(6),
  },
  productNameSecond: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginTop: pxToPercentY(2),
  },
  addButtonInline: {
    minWidth: 88,
    height: 36,
  },
  quantityInlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    paddingHorizontal: 6,
    gap: 6,
  },
  quantityBtnInline: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityTextInline: {
    minWidth: 20,
    textAlign: 'center',
    fontWeight: '700',
  },
  foodName: {
    fontSize: 18,
    fontFamily: appTypography.semiBold,
    marginBottom: pxToPercentY(4),
  },
  foodDescription: {
    fontSize: 14,
    fontFamily: appTypography.regular,
    lineHeight: 20,
    marginBottom: pxToPercentY(12),
  },
  foodCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  price: {
    fontSize: 18,
    fontWeight: '700',
    marginRight: 12,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rating: {
    fontSize: 14,
    marginLeft: 4,
  },
  addButton: {
    minWidth: 80,
  },

  // New product card container
  productCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 8,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },

  // Search Bar Styles
  searchBarContainer: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 25,
    borderWidth: 1,
    paddingHorizontal: 20,
    height: 40,
    minWidth: 300,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  clearButton: {
    padding: 4,
  },

  // Shimmer Styles
  shimmerContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
    overflow: 'hidden',
  },
  shimmer: {
    width: '100%',
    height: '100%',
    opacity: 0.3,
  },

  // Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerButton: {
    padding: 8,
    marginRight: 12,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerLogo: {
    height: 40,
    width: 120,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 24,
    marginBottom: 2,
    ...getFontStyle('bold'),
  },
  headerSubtitle: {
    fontSize: 16,
    ...getFontStyle('regular'),
  },

  // Floating Action Button Styles
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    borderRadius: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabTouchable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 36,
  },

  // Progress Bar Styles
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginVertical: 12,
  },
  progressBackground: {
    flex: 1,
    height: '100%',
    borderRadius: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 10,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 10,
  },

  // Toggle Switch Styles
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    padding: 2,
    marginVertical: 10,
  },
  toggleThumb: {
    borderRadius: 12,
  },

  // Swipeable Food Card Styles
  swipeableFoodCard: {
    borderRadius: 20,
    marginHorizontal: 8,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
    position: 'relative',
  },
  favoriteButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },

  // Bottom Sheet Styles
  bottomSheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  bottomSheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  bottomSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  bottomSheetContent: {
    padding: 16,
  },

  // Skeleton Loader Styles
  skeletonCard: {
    borderRadius: 10,
    marginVertical: 8,
    marginHorizontal: 16,
    height: 150,
  },
  skeletonText: {
    borderRadius: 5,
    marginVertical: 4,
    height: 12,
  },
  skeletonAvatar: {
    borderRadius: 20,
    marginVertical: 8,
    marginHorizontal: 16,
    height: 50,
    width: 50,
  },
  skeletonButton: {
    borderRadius: 10,
    marginVertical: 8,
    marginHorizontal: 16,
    height: 40,
  },

  // Enhanced Category Chip Styles
  categoryCircleContainer: {
    alignItems: 'center',
    marginHorizontal: 8,
  },
  categoryCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  categoryEmoji: {
    textAlign: 'center',
  },
  categoryLabel: {
    fontSize: 12,
    maxWidth: 86,
  },

  // Parallax Header Styles
  parallaxHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: -1,
  },
  parallaxImage: {
    width: '100%',
    height: '100%',
  },
  parallaxGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  parallaxContent: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  parallaxTitle: {
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  parallaxSubtitle: {
    fontSize: 18,
    fontWeight: '400',
  },

  // Pull to Refresh Styles
  pullToRefreshContainer: {
    flex: 1,
  },

  // Enhanced Shimmer Styles
  enhancedShimmerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    padding: 16,
  },
  shimmerListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  shimmerAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  shimmerTextContainer: {
    flex: 1,
  },
  shimmerTitle: {
    height: 20,
    marginBottom: 4,
  },
  shimmerSubtitle: {
    height: 16,
  },
  shimmerGridItem: {
    width: '48%',
    marginVertical: 8,
  },
  shimmerGridCard: {
    height: 150,
    marginBottom: 8,
  },
  shimmerGridTitle: {
    height: 18,
  },
});

export default {
  GlassCard,
  GradientButton,
  CategoryChip,
  AnimatedFoodCard,
  ModernSearchBar,
  LoadingShimmer,
  ModernHeader,
  FloatingActionButton,
  ModernProgressBar,
  ModernToggleSwitch,
  SwipeableFoodCard,
  ModernBottomSheet,
  SkeletonLoader,
  AnimatedCategoryChip,
  ParallaxHeader,
  ModernPullToRefresh,
  EnhancedLoadingShimmer,
}; 