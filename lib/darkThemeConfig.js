// Modern Dark Theme Configuration with Glassmorphism and Trendy Colors
// This file provides a contemporary design system for the canteen app

export const darkThemeColors = {
  // Primary colors — pure black base
  background: '#000000',
  surface: '#000000',
  card: '#000000',
  
  // Glassmorphism surfaces (black + subtle lift)
  glassSurface: 'rgba(0, 0, 0, 0.94)',
  glassCard: 'rgba(255, 255, 255, 0.04)',
  glassBorder: 'rgba(255, 255, 255, 0.12)',
  
  // Text colors - High contrast white hierarchy
  text: '#FFFFFF',
  textSecondary: '#E2E8F0', // Light gray for better readability
  textTertiary: '#94A3B8', // Medium gray
  textMuted: '#64748B', // Muted gray
  
  // Brand colors - Vibrant but not harsh
  primary: '#60A5FA', // Soft blue
  primaryGradient: ['#60A5FA', '#3B82F6'],
  secondary: '#A78BFA', // Soft purple
  secondaryGradient: ['#A78BFA', '#8B5CF6'],
  accent: '#34D399', // Soft green
  accentGradient: ['#34D399', '#10B981'],
  
  // Status colors - Different colors for order status (dark theme)
  success: '#10B981', // Green for delivered
  successGradient: ['#10B981', '#059669'],
  warning: '#F59E0B', // Orange for pending
  warningGradient: ['#F59E0B', '#D97706'],
  error: '#EF4444', // Red for cancelled/error
  errorGradient: ['#EF4444', '#DC2626'],
  info: '#3B82F6', // Blue for ready/preparing
  infoGradient: ['#3B82F6', '#2563EB'],
  
  // Border and divider colors (neutral on black)
  border: '#333333',
  divider: '#262626',
  
  // Overlay and shadow colors
  overlay: 'rgba(0, 0, 0, 0.85)',
  shadow: '#000000',
  shadowLight: 'rgba(0, 0, 0, 0.45)',
  
  // Navigation specific colors
  navigationBackground: '#000000',
  navigationCard: '#000000',
  navigationBorder: '#333333',
  
  // Splash and loading colors
  splashBackground: '#000000',
  loadingBackground: '#000000',
  
  // Input and form colors
  inputBackground: 'rgba(255, 255, 255, 0.06)',
  inputBorder: 'rgba(255, 255, 255, 0.15)',
  inputPlaceholder: '#64748B',
  inputFocus: 'rgba(96, 165, 250, 0.3)',
  
  // Button colors - Soft and vibrant
  buttonPrimary: '#60A5FA',
  buttonPrimaryGradient: ['#60A5FA', '#3B82F6'],
  buttonSecondary: '#A78BFA',
  buttonSecondaryGradient: ['#A78BFA', '#8B5CF6'],
  buttonAccent: '#34D399',
  buttonAccentGradient: ['#34D399', '#10B981'],
  buttonDisabled: '#404040',
  
  // Tab bar colors
  tabBarBackground: 'rgba(0, 0, 0, 0.96)',
  tabBarBorder: 'rgba(255, 255, 255, 0.12)',
  tabBarActive: '#60A5FA',
  tabBarInactive: '#64748B',
  
  // Special effects colors
  neon: '#60A5FA',
  glow: '#A78BFA',
  shimmer: 'rgba(96, 165, 250, 0.1)',
  
  // Category colors for food items - Soft and vibrant
  categoryColors: {
    Italian: '#60A5FA',
    Indian: '#A78BFA',
    Western: '#34D399',
    Chinese: '#F59E0B',
    Beverages: '#EF4444',
    Desserts: '#EC4899',
    All: '#60A5FA'
  },

  // App layout (stack, lists, cards)
  contentBackground: '#000000',
  pageBackground: '#000000',
  elevatedSurface: '#000000',
  loginCanvas: '#000000',
  mutedRowBackground: '#000000',
  searchFieldBackground: 'rgba(0, 0, 0, 0.92)',
  foodCardVegFill: ['#000000', '#000000'],
  foodCardNeutralFill: ['#000000', '#000000'],
  quantityStripBackground: 'rgba(255, 255, 255, 0.06)',
  nutritionBoxBackground: 'rgba(255, 255, 255, 0.06)',
  dangerTintBackground: 'rgba(239, 68, 68, 0.12)',
  /** Same as brand yellow — primary accent is yellow, not orange */
  brandOrange: '#F5BC3B',
  brandYellow: '#F5BC3B',
  /** Darkest gold/yellow in the brand palette (for text on light or dark surfaces) */
  brandYellowDark: '#8B6914',
  accentGreen: '#00B330',
  searchHighlightBg: 'rgba(251, 191, 36, 0.22)',
  searchHighlightText: '#FBBF24',
  searchFocusedTint: 'rgba(245, 188, 59, 0.12)',
  /** Outline so item cards read on pure-black backgrounds */
  itemCardOutline: '#FFFFFF',
};

export const lightThemeColors = {
  // Primary colors - Pure black and white
  background: '#FFFFFF',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  
  // Glassmorphism surfaces for light theme
  glassSurface: 'rgba(255, 255, 255, 0.9)',
  glassCard: 'rgba(0, 0, 0, 0.03)',
  glassBorder: 'rgba(0, 0, 0, 0.08)',
  
  // Text colors - Pure black and white hierarchy
  text: '#000000',
  textSecondary: '#333333',
  textTertiary: '#666666',
  textMuted: '#999999',
  
  // Brand colors - Pure black and white
  primary: '#000000',
  primaryGradient: ['#000000', '#333333'],
  secondary: '#666666',
  secondaryGradient: ['#999999', '#666666'],
  accent: '#000000',
  accentGradient: ['#000000', '#333333'],
  
  // Status colors - Different colors for order status
  success: '#10B981', // Green for delivered
  successGradient: ['#10B981', '#059669'],
  warning: '#F59E0B', // Orange for pending
  warningGradient: ['#F59E0B', '#D97706'],
  error: '#EF4444', // Red for cancelled/error
  errorGradient: ['#EF4444', '#DC2626'],
  info: '#3B82F6', // Blue for ready/preparing
  infoGradient: ['#3B82F6', '#2563EB'],
  
  // Border and divider colors - Pure black and white
  border: '#E0E0E0',
  divider: '#F0F0F0',
  glassBorder: 'rgba(0, 0, 0, 0.06)',
  
  // Overlay and shadow colors - Black and white
  overlay: 'rgba(0, 0, 0, 0.4)',
  shadow: '#000000',
  shadowLight: 'rgba(0, 0, 0, 0.1)',
  
  // Navigation specific colors
  navigationBackground: '#FFFFFF',
  navigationCard: '#FFFFFF',
  navigationBorder: '#E0E0E0',
  
  // Splash and loading colors
  splashBackground: '#FFFFFF',
  loadingBackground: '#FFFFFF',
  
  // Input and form colors - Black and white
  inputBackground: '#F8F8F8',
  inputBorder: 'rgba(0, 0, 0, 0.08)',
  inputPlaceholder: '#999999',
  inputFocus: 'rgba(0, 0, 0, 0.15)',
  
  // Button colors - Pure black and white
  buttonPrimary: '#000000',
  buttonPrimaryGradient: ['#000000', '#333333'],
  buttonSecondary: '#666666',
  buttonSecondaryGradient: ['#999999', '#666666'],
  buttonAccent: '#000000',
  buttonAccentGradient: ['#000000', '#333333'],
  buttonDisabled: '#CCCCCC',
  
  // Tab bar colors - Black and white
  tabBarBackground: 'rgba(255, 255, 255, 0.95)',
  tabBarBorder: 'rgba(0, 0, 0, 0.06)',
  tabBarActive: '#000000',
  tabBarInactive: '#999999',
  
  // Special effects colors
  neon: '#000000',
  glow: '#000000',
  shimmer: 'rgba(0, 0, 0, 0.05)',
  
  // Category colors for food items - Black and white
  categoryColors: {
    Italian: '#000000',
    Indian: '#333333',
    Western: '#666666',
    Chinese: '#000000',
    Beverages: '#333333',
    Desserts: '#666666',
    All: '#000000'
  },

  contentBackground: '#FFF7ED',
  pageBackground: '#F7F7F8',
  elevatedSurface: '#FFFFFF',
  loginCanvas: '#fcfff7',
  mutedRowBackground: '#F5F5F5',
  searchFieldBackground: '#F5F5F5',
  foodCardVegFill: ['#E6FAE1', '#E6FAE1'],
  foodCardNeutralFill: ['#FFFFFF', '#FFFFFF'],
  quantityStripBackground: 'rgba(235, 236, 255, 0.47)',
  nutritionBoxBackground: '#EBECFF',
  dangerTintBackground: '#FFF5F5',
  brandOrange: '#F5BC3B',
  brandYellow: '#F5BC3B',
  /** Darkest gold/yellow in the brand palette (for text on light or dark surfaces) */
  brandYellowDark: '#8B6914',
  accentGreen: '#00B330',
  searchHighlightBg: '#FEF3C7',
  searchHighlightText: '#92400E',
  searchFocusedTint: '#FFF9E6',
  itemCardOutline: 'rgba(0, 0, 0, 0.08)',
};

/** Single app typeface — PostScript names must match `Font.loadAsync` in `utils/fonts.js`. */
export const appTypography = {
  regular: 'Afacad',
  medium: 'Afacad-Medium',
  semiBold: 'Afacad-SemiBold',
  bold: 'Afacad-Bold',
};

// Navigation theme configuration
export const getNavigationTheme = (isDarkMode) => ({
  dark: isDarkMode,
  colors: isDarkMode ? {
    primary: darkThemeColors.primary,
    background: darkThemeColors.navigationBackground,
    card: darkThemeColors.navigationCard,
    text: darkThemeColors.text,
    border: darkThemeColors.navigationBorder,
    notification: darkThemeColors.primary,
  } : {
    primary: lightThemeColors.primary,
    background: lightThemeColors.navigationBackground,
    card: lightThemeColors.navigationCard,
    text: lightThemeColors.text,
    border: lightThemeColors.navigationBorder,
    notification: lightThemeColors.primary,
  },
});

// Screen transition configuration
export const getScreenTransitionConfig = (isDarkMode) => ({
  cardStyle: { 
    backgroundColor: isDarkMode ? darkThemeColors.navigationBackground : lightThemeColors.navigationBackground 
  },
  cardOverlayEnabled: false,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
  transitionSpec: {
    open: {
      animation: 'timing',
      config: {
        duration: 150,
      },
    },
    close: {
      animation: 'timing',
      config: {
        duration: 150,
      },
    },
  },
  cardStyleInterpolator: ({ current, layouts }) => {
    return {
      cardStyle: {
        transform: [
          {
            translateX: current.progress.interpolate({
              inputRange: [0, 1],
              outputRange: [layouts.screen.width, 0],
            }),
          },
        ],
        backgroundColor: isDarkMode ? darkThemeColors.navigationBackground : lightThemeColors.navigationBackground,
      },
      overlayStyle: {
        backgroundColor: 'transparent',
      },
    };
  },
}); 