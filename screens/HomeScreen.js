import React, { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  RefreshControl,
  Switch,
  Image,
  Animated,
  TextInput,
  StatusBar,
  ScrollView,
  Easing,
  Modal,
  Pressable,
  TouchableWithoutFeedback,
} from 'react-native';
import Constants from 'expo-constants';
import AppIcon from '../components/AppIcon';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from '../lib/AuthContext';
import { useCart } from '../lib/CartContext';
import { useTheme } from '../lib/ThemeContext';
import { useCanteenStatus } from '../lib/CanteenStatusContext';
// Cart toast removed
import { foodService, subscribeToFoodAvailability, supabase, deriveItemIsAvailable } from '../lib/supabase';
import { getFontStyle } from '../lib/utils/fonts';
import {
  ModernHeader,
  ModernSearchBar,
  AnimatedFoodCard,
  GlassCard,
  EnhancedLoadingShimmer,
} from '../components/ModernComponents';
import NotificationService from '../lib/NotificationService';
import BottomSnackbar from '../components/BottomSnackbar';
import { sortItemsByTime, getTimeSortingInfo, getTimePeriodDescription } from '../lib/utils/timeBasedSorting';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOADING_MASCOT, CANTEEN_STATUS_LOGO, NO_ITEMS_EMPTY_ILLUSTRATION } from '../lib/appLogo';
import { appTypography } from '../lib/darkThemeConfig';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CanteenClosedMessage from '../components/CanteenClosedMessage';
import { pxToPercentX, pxToPercentY } from '../utils/percent';
import { invalidateHttpMenuCache, menuFromHttpEnabled } from '../lib/menuHttp';

const { width, height } = Dimensions.get('window');

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);

const CATEGORIES_CACHE_KEY = 'cachedCategoriesV1';
const MENU_PAGE_SIZE = 10;

// Clerk-related veg preference bridge was removed; keep veg mode local-only for now.
const fetchUserVegModeEnabled = async () => null;
const updateUserVegModeEnabled = async () => ({ ok: true, error: null });

const DEFAULT_CATEGORIES = [
  {
    id: 'category-breakfast',
    name: 'Breakfast',
    icon: '🍳',
    sort_order: 1,
    is_active: true,
  },
  {
    id: 'category-lunch',
    name: 'Lunch',
    icon: '🍱',
    sort_order: 2,
    is_active: true,
  },
  {
    id: 'category-snacks',
    name: 'Snacks',
    icon: '🥪',
    sort_order: 3,
    is_active: true,
  },
  {
    id: 'category-beverages',
    name: 'Beverages',
    icon: '🥤',
    sort_order: 4,
    is_active: true,
  },
  {
    id: 'category-combos',
    name: 'Combos',
    icon: '🍽️',
    sort_order: 5,
    is_active: true,
  },
  {
    id: 'category-vegetarian',
    name: 'Vegetarian',
    icon: '🥗',
    sort_order: 6,
    is_active: true,
  },
];

// Auto-scroll constants removed to keep bar position fixed

const HomeScreen = ({ navigation, route }) => {
  const { signOut, user } = useAuth();
  // Get firstName from user metadata with safe fallback
  const firstName = user?.user_metadata?.first_name || null;
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    cartItems: cart,
    addToCart,
    getItemQuantity,
    increaseQuantity,
    decreaseQuantity,
    getTotalItems,
    getTotalPrice,
    clearCart,
  } = useCart();
  const { canteenStatus, checkCanteenStatus } = useCanteenStatus();
  /** Closed overlay / cart locks only after a successful server read (avoids offline → false “closed”). */
  const kitchenConfirmedClosed = useMemo(
    () => !!(canteenStatus.statusKnownFromServer && !canteenStatus.isOpen),
    [canteenStatus.statusKnownFromServer, canteenStatus.isOpen]
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [dynamicPlaceholder, setDynamicPlaceholder] = useState('Search for your favorite food...');
  const [activeFilter, setActiveFilter] = useState('all'); // All items selected by default
  const [priceSort, setPriceSort] = useState('none'); // none, low-to-high, high-to-low
  const [dietaryFilter, setDietaryFilter] = useState('all'); // all, veg, non-veg
  const [showPriceDropdown, setShowPriceDropdown] = useState(false);
  const [vegMode, setVegMode] = useState(false); // Veg Mode toggle state

  // New trendy UI state
  const [refreshing, setRefreshing] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);
  const flatListRef = useRef(null);
  const bannerFlatListRef = useRef(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const isAtTopRef = useRef(true);

  const bannerHeight = (width - 32) * (550 / 1280); // original aspect ratio
  /** Same as CartScreen `styles.topStrip.height` (34) */
  const TOP_STRIP_HEIGHT = 34;
  const FIXED_HEADER_OFFSET_TOP = TOP_STRIP_HEIGHT;
  const FIXED_HEADER_HEIGHT = FIXED_HEADER_OFFSET_TOP + 60;
  const SEARCH_BAR_HEIGHT = 56;
  const CATEGORIES_SECTION_HEIGHT = 84;
  
  const bannerOpacity = scrollY.interpolate({
    inputRange: [0, bannerHeight * 0.8],
    outputRange: [1, 0.88],
    extrapolate: 'clamp',
  });

  const yellowBarHeight = 28; // Height of yellow bar at top
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);
  const [bannerLoading, setBannerLoading] = useState({}); // Track loading state for each banner
  
  const banners = useMemo(() => [
    { id: 'banner-1', type: 'image', source: require('../assets/home-banner.webp') },
  ], []);

  // Preload images - local assets are already bundled, just mark as ready
  useEffect(() => {
    banners.forEach((banner) => {
      setBannerLoading((prev) => ({ ...prev, [banner.id]: false }));
    });
  }, [banners]);

  const handleMainListScroll = useCallback((event) => {
    const y = event?.nativeEvent?.contentOffset?.y ?? 0;
    const atTop = y <= 10;
    if (atTop !== isAtTopRef.current) {
      isAtTopRef.current = atTop;
      setIsAtTop(atTop);
    }
  }, []);
  
  // Handle viewable items change for banner tracking
  const handleViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      const newIndex = viewableItems[0].index;
      if (newIndex !== null && newIndex !== activeBannerIndex) {
        setActiveBannerIndex(newIndex);
      }
    }
  }, [activeBannerIndex]);
  
  // Animation states
  const vegDotScale = useRef(new Animated.Value(0)).current; // for translateX (useNativeDriver:true)
  const vegBgOpacity = useRef(new Animated.Value(0)).current; // for bg color (useNativeDriver:false)
  const categoryScales = useRef({}).current;
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const snackbarHideTimer = useRef(null);
  const availabilityChannelRef = useRef(null);
  /** Invalidates in-flight `subscribeToFoodAvailability` after deps change or unmount (avoids CHANNEL_ERROR spam). */
  const foodAvailabilitySubGenRef = useRef(0);

  // Canteen switcher (only canteens of user's college)
  const [currentCanteenName, setCurrentCanteenName] = useState('');
  const [currentCanteenId, setCurrentCanteenId] = useState(null);
  /** When false, menu must not load unscoped items (avoids cart/order mismatch with `create_order_minimal`). */
  const [menuCanteenReady, setMenuCanteenReady] = useState(false);
  const [collegeCanteens, setCollegeCanteens] = useState([]);
  const [showCanteenPicker, setShowCanteenPicker] = useState(false);
  const [canteenPickerLoading, setCanteenPickerLoading] = useState(false);
  
  
  
  
  

  // Veg mode: scheduled days (local) override; else signed-in users use public.users.veg_mode_enabled
  const loadVegModePreference = useCallback(async () => {
    try {
      const saved = await AsyncStorage.getItem('vegMode');
      const savedCustomize = await AsyncStorage.getItem('vegModeCustomize');
      const savedSelectedDays = await AsyncStorage.getItem('vegModeSelectedDays');

      const customizeOn = savedCustomize !== null && JSON.parse(savedCustomize);
      const selectedDays =
        savedSelectedDays !== null ? JSON.parse(savedSelectedDays) : null;
      const today = new Date()
        .toLocaleDateString('en-US', { weekday: 'long' })
        .toLowerCase();

      if (customizeOn && selectedDays && selectedDays[today]) {
        setVegMode(true);
        await AsyncStorage.setItem('vegMode', JSON.stringify(true));
        if (user?.id) {
          const { ok, error } = await updateUserVegModeEnabled(user.id, true);
          if (!ok && error) console.log('Veg mode backend sync:', error.message);
        }
        return;
      }

      if (user?.id) {
        const fromBackend = await fetchUserVegModeEnabled(user.id);
        if (fromBackend !== null) {
          setVegMode(fromBackend);
          await AsyncStorage.setItem('vegMode', JSON.stringify(fromBackend));
          return;
        }
      }

      if (saved !== null) {
        setVegMode(JSON.parse(saved));
      } else {
        setVegMode(false);
      }
    } catch (error) {
      console.log('Error loading veg mode:', error);
    }
  }, [user?.id]);

  useEffect(() => {
    loadVegModePreference();
  }, [loadVegModePreference]);

  // Animate the knob (native driver) and bg (non-native) separately to avoid mixing error
  useEffect(() => {
    const toVal = vegMode ? 1 : 0;
    Animated.spring(vegDotScale, {
      toValue: toVal,
      useNativeDriver: true,
      tension: 120,
      friction: 10,
    }).start();
    Animated.timing(vegBgOpacity, {
      toValue: toVal,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [vegMode, vegDotScale, vegBgOpacity]);

  useFocusEffect(
    useCallback(() => {
      loadVegModePreference();
    }, [loadVegModePreference])
  );


  // Veg mode dot animation effect
  useEffect(() => {
    if (vegMode) {
      // Animate dot scale from 0 to 1 when veg mode is turned on
      Animated.timing(vegDotScale, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    } else {
      // Animate dot scale from 1 to 0 when veg mode is turned off
      Animated.timing(vegDotScale, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [vegMode]);


  // Cycle through specific search placeholder items
  useEffect(() => {
    const specificItems = [
      'veg manchurian',
      'meals', 
      'masala dosa',
      'veg parata',
      'mysore bajji'
    ];

    let currentIndex = 0;

    const cyclePlaceholder = () => {
      // Move to next item
      currentIndex = (currentIndex + 1) % specificItems.length;
      const nextItem = specificItems[currentIndex];
      
      // Update placeholder text
      setDynamicPlaceholder(`Search for "${nextItem}"`);
    };

    // Initial cycle - set first item
    setDynamicPlaceholder(`Search for "${specificItems[0]}"`);

    // Set up interval to cycle every 5 seconds
    const interval = setInterval(cyclePlaceholder, 5000);

    return () => clearInterval(interval);
  }, []);

  // Emoji animation removed - static emoji display


  const handleVegModeToggle = useCallback(async () => {
    try {
      const newValue = !vegMode;
      setVegMode(newValue);
      
      await AsyncStorage.setItem('vegMode', JSON.stringify(newValue));
      if (user?.id) {
        const { ok, error } = await updateUserVegModeEnabled(user.id, newValue);
        if (!ok && error) console.log('Error saving veg mode to backend:', error.message);
      }
    } catch (error) {
      console.log('Error saving veg mode:', error);
    }
  }, [vegMode, user?.id]);

  const performCanteenSwitch = useCallback(
    async (canteen) => {
      if (!user?.id) return;
      if (canteen?.is_open === false) {
        setShowCanteenPicker(false);
        return;
      }
      setCanteenPickerLoading(true);
      try {
        const { error } = await supabase.from('users').update({ canteen_id: canteen.id }).eq('id', user.id);
        if (error) throw error;
        setCurrentCanteenId(canteen.id);
        setCurrentCanteenName(canteen.name);
        setShowCanteenPicker(false);
        checkCanteenStatus();
        await fetchCategories();
      } catch (e) {
        console.error('Change canteen error:', e);
        Alert.alert('Error', 'Could not change canteen. Try again.');
      } finally {
        setCanteenPickerLoading(false);
      }
    },
    [user?.id, checkCanteenStatus, fetchCategories]
  );

  const handleSelectCanteen = useCallback(
    (canteen) => {
      if (!user?.id) {
        setShowCanteenPicker(false);
        return;
      }
      if (canteen?.is_open === false) {
        setShowCanteenPicker(false);
        return;
      }
      const sameCanteen =
        currentCanteenId != null && String(canteen.id) === String(currentCanteenId);
      if (sameCanteen) {
        setShowCanteenPicker(false);
        return;
      }

      if (getTotalItems() > 0) {
        Alert.alert(
          'Change canteen?',
          'Your cart is for the current canteen. Switching will remove all items from your cart.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => setShowCanteenPicker(false),
            },
            {
              text: 'Clear cart & switch',
              style: 'destructive',
              onPress: () => {
                void (async () => {
                  try {
                    // ✅ error handled
                    await clearCart();
                    await performCanteenSwitch(canteen);
                  } catch (e) {
                    console.error('Change canteen (after clear cart):', e);
                    Alert.alert('Error', 'Could not switch canteen. Try again.');
                  }
                })();
              },
            },
          ]
        );
        return;
      }

      void performCanteenSwitch(canteen);
    },
    [user?.id, currentCanteenId, getTotalItems, clearCart, performCanteenSwitch]
  );

  // Categories state
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const fallbackCategoriesAppliedRef = useRef(false);
  
  const hasCategories = Array.isArray(categories) && categories.length > 0;
  const showCategorySkeleton = categoriesLoading && !hasCategories;

  // Quick Actions - All Items + dynamic categories from database
  const quickActions = useMemo(() => {
    // Always show "All Items" even while loading, so categories section is visible
    const baseAction = {
      id: 'all',
      title: 'All Items',
      image_url: null,
      icon: '🍽️',
      filter: 'all'
    };
    
    if (!hasCategories) {
      return [baseAction];
    }
    
    // Safety check for categories
    // Find "All Items" category from database
    const allItemsCategory = categories.find(category => 
      category && category.name && (
        category.name.toLowerCase() === 'all items' || 
        category.name.toLowerCase() === 'all'
      )
    );
    
    // Create base actions with "All Items" from database or fallback
    const baseActions = allItemsCategory ? [
      {
        id: 'all',
        title: allItemsCategory.name,
        image_url: allItemsCategory.image_url || null,
        icon: allItemsCategory.icon || '🍽️',
        filter: 'all'
      }
    ] : [
      {
        id: 'all',
        title: 'All Items',
        image_url: null,
        icon: '🍽️',
        filter: 'all'
      }
    ];
    
    // Add other dynamic categories from database with duplicate removal and image validation
    const seenCategories = new Set(['all']); // Include base action ID to prevent conflicts
    const dynamicCategories = categories
      .filter(category => {
        // Safety check for category
        if (!category || !category.name) {
          return false;
        }
        
        // Skip "All Items" category as it's already in baseActions
        if (category.name.toLowerCase() === 'all items' || category.name.toLowerCase() === 'all') {
          return false;
        }
        
        // Remove duplicates based on category name (case insensitive)
        const categoryKey = category.name.toLowerCase();
        if (seenCategories.has(categoryKey)) {
          return false;
        }
        seenCategories.add(categoryKey);
        
        // Include all categories regardless of image (backend determines what should be shown)
        return true;
      })
      .map(category => ({
        id: `category-${category.name.toLowerCase()}`, // Add prefix to ensure uniqueness
        title: category.name,
        image_url: category.image_url || null, // Don't use fallback image if we have icon
        icon: category.icon || '🍽️', // Use icon from database or fallback emoji
        filter: `category-${category.name.toLowerCase()}`, // Use the same format as the id for consistency
      }));
    
    const allActions = [...baseActions, ...dynamicCategories];
    return allActions;
  }, [categories, hasCategories]);

  // Removed auto-scroll state/logic to avoid moving the list on selection

  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [menuLoadError, setMenuLoadError] = useState(null);
  const nextOffsetRef = useRef(0);
  const pagingInFlightRef = useRef(false);
  const menuAutoPrefetchSafetyRef = useRef(0);

  const serverCategoryIdForPaging = useMemo(() => {
    if (activeFilter === 'all') return null;
    if (typeof activeFilter !== 'string' || !activeFilter.startsWith('category-')) return null;
    const nameNorm = activeFilter.slice('category-'.length).toLowerCase();
    const cat = categories.find((c) => c?.name && String(c.name).toLowerCase() === nameNorm);
    return cat?.id ?? null;
  }, [activeFilter, categories]);

  const transformRawToMenuRows = useCallback((data) => {
    if (!Array.isArray(data)) return [];

    const toBoolean = (value) => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 't', 'yes', 'y', '1', 'veg', 'vegetarian'].includes(normalized)) return true;
        if (['false', 'f', 'no', 'n', '0', 'non-veg', 'nonveg'].includes(normalized)) return false;
      }
      return Boolean(value);
    };

    return data.map((item) => {
      const isVegetarian = toBoolean(
        item.is_vegetarian ?? item.is_vegeterian ?? item.isVegetarian ?? null
      );

      return {
        ...item,
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        category: item.categories?.name || 'Other',
        category_id: item.category_id,
        image:
          item.image_url && item.image_url.trim() !== ''
            ? item.image_url
            : null,
        isAvailable: deriveItemIsAvailable(item),
        isVegetarian,
        reviews: item.reviews_count,
        ingredients: item.ingredients || [],
        preparation: item.preparation || [],
        cookingTime: item.cooking_time,
        spiceLevel: item.spice_level,
        calories: item.calories,
      };
    });
  }, []);

  const reloadMenuFromStart = useCallback(async () => {
    if (user?.id && !menuCanteenReady) return;

    if (menuFromHttpEnabled()) {
      invalidateHttpMenuCache();
    }

    pagingInFlightRef.current = true;
    menuAutoPrefetchSafetyRef.current = 0;
    setMenuLoadError(null);
    setLoadingMore(false);
    setLoading(true);
    setMenuItems([]);
    nextOffsetRef.current = 0;
    setHasMore(true);

    try {
      const canteenFilter = user?.id ? currentCanteenId : null;
      const { data: rawRows, error, hasMore: more } = await foodService.getFoodItemsPage(
        serverCategoryIdForPaging,
        canteenFilter,
        0,
        MENU_PAGE_SIZE,
        { forceHttpRefresh: menuFromHttpEnabled() }
      );

      const rows = transformRawToMenuRows(rawRows || []);

      if (error) {
        setMenuLoadError('Could not load menu. Pull down to refresh or try again.');
        setMenuItems([]);
        setHasMore(false);
        return;
      }

      setMenuItems(rows);
      nextOffsetRef.current = rows.length;
      setHasMore(!!more);
    } catch (e) {
      setMenuLoadError('Could not load menu. Pull down to refresh or try again.');
      setMenuItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
      pagingInFlightRef.current = false;
    }
  }, [user?.id, menuCanteenReady, currentCanteenId, serverCategoryIdForPaging, transformRawToMenuRows]);

  const fetchMenuNextPage = useCallback(async () => {
    if (!hasMore || loading || loadingMore || pagingInFlightRef.current) return;
    if (user?.id && !menuCanteenReady) return;

    pagingInFlightRef.current = true;
    setLoadingMore(true);

    try {
      const canteenFilter = user?.id ? currentCanteenId : null;
      const offset = nextOffsetRef.current;
      const { data: rawRows, error, hasMore: more } = await foodService.getFoodItemsPage(
        serverCategoryIdForPaging,
        canteenFilter,
        offset,
        MENU_PAGE_SIZE
      );

      if (error) {
        setMenuLoadError('Could not load more items. Please try again.');
        setHasMore(false);
        return;
      }

      const batch = transformRawToMenuRows(rawRows || []);
      const sliceLen = batch.length;

      if (sliceLen === 0) {
        setHasMore(false);
        return;
      }

      setMenuItems((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const merged = [...prev];
        for (const row of batch) {
          if (row?.id != null && !seen.has(row.id)) {
            seen.add(row.id);
            merged.push(row);
          }
        }
        return merged;
      });

      nextOffsetRef.current = offset + sliceLen;
      setHasMore(!!more);
    } finally {
      setLoadingMore(false);
      pagingInFlightRef.current = false;
    }
  }, [
    hasMore,
    loading,
    loadingMore,
    user?.id,
    menuCanteenReady,
    currentCanteenId,
    serverCategoryIdForPaging,
    transformRawToMenuRows,
  ]);

  const fetchCategories = useCallback(async () => {
    try {
      // Don't set loading to true immediately - show categories section first
      // This makes the UI smoother
      const { data, error } = await foodService.getCategories();
      if (error) {
        console.error('Error fetching categories:', error);
      if (!fallbackCategoriesAppliedRef.current) {
        setCategories([]);
      }
        setCategoriesLoading(false);
      } else if (Array.isArray(data)) {
        // Sort categories by sort_order, then by name
        const sortedCategories = data.sort((a, b) => {
          // First sort by sort_order (if available)
          if (a.sort_order !== undefined && b.sort_order !== undefined) {
            if (a.sort_order !== b.sort_order) {
              return a.sort_order - b.sort_order;
            }
          }
          // Then sort by name
          return a.name.localeCompare(b.name);
        });
        
        fallbackCategoriesAppliedRef.current = false;
        setCategories(sortedCategories);
        setCategoriesLoading(false);
        try {
          await AsyncStorage.setItem(CATEGORIES_CACHE_KEY, JSON.stringify(sortedCategories));
        } catch (cacheError) {
          console.log('Error caching categories:', cacheError);
        }
      } else {
        if (!fallbackCategoriesAppliedRef.current) {
          setCategories([]);
        }
        setCategoriesLoading(false);
      }
    } catch (err) {
      console.error('Network error fetching categories:', err);
      if (!fallbackCategoriesAppliedRef.current) {
        setCategories([]);
      }
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setMenuCanteenReady(true);
    } else {
      setMenuCanteenReady(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const loadCachedCategories = async () => {
      try {
        const cached = await AsyncStorage.getItem(CATEGORIES_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setCategories(parsed);
            setCategoriesLoading(false);
          }
        }
      } catch (error) {
        console.log('Error loading cached categories:', error);
      }
    };

    loadCachedCategories();
  }, []);

  // Initial load — categories only; items load after canteen is known (signed-in) or immediately (guest)
  useEffect(() => {
    setCategoriesLoading(true);
    setLoading(true);
    fetchCategories().catch((err) => {
      console.error('Error during initial categories load:', err);
      setCategoriesLoading(false);
    });
  }, []);

  useEffect(() => {
    reloadMenuFromStart();
  }, [reloadMenuFromStart]);

  // Listen for tab press events to handle scroll to top
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', (e) => {
      // Only handle if we're not at the top
      if (!isAtTop) {
        e.preventDefault();
        scrollToTop();
      }
    });

    return unsubscribe;
  }, [navigation, isAtTop, scrollToTop]);

  // Realtime subscribe to availability updates (uses available_stock column)
  useEffect(() => {
    if (availabilityChannelRef.current) {
      try {
        supabase.removeChannel(availabilityChannelRef.current);
      } catch (e) {}
      availabilityChannelRef.current = null;
    }

    const myGen = ++foodAvailabilitySubGenRef.current;

    const setupSubscription = async () => {
      const channel = await subscribeToFoodAvailability(
        (payload) => {
          const newRow = payload?.new || {};
          const updatedId = newRow.id;
          if (!updatedId) return;
          const newIsAvailable = deriveItemIsAvailable(newRow);
          setMenuItems((prev) =>
            prev.map((item) =>
              item.id === updatedId
                ? { ...item, isAvailable: newIsAvailable, available_stock: newRow.available_stock }
                : item
            )
          );
        },
        { userId: user?.id ?? null, canteenId: currentCanteenId ?? null }
      );

      if (myGen !== foodAvailabilitySubGenRef.current) {
        if (channel) {
          try {
            supabase.removeChannel(channel);
          } catch (e) {}
        }
        return;
      }
      availabilityChannelRef.current = channel;
    };

    setupSubscription();

    return () => {
      foodAvailabilitySubGenRef.current += 1;
      if (availabilityChannelRef.current) {
        try {
          supabase.removeChannel(availabilityChannelRef.current);
        } catch (e) {}
        availabilityChannelRef.current = null;
      }
    };
  }, [user?.id, currentCanteenId]);

  // Check for automatic Veg Mode activation and sync with Profile screen when screen comes into focus
  // DISABLED TEMPORARILY TO CHECK FOR LOOP ISSUE
  // const hasSyncedVegMode = useRef(false);
  // useFocusEffect(
  //   useCallback(() => {
  //     // Only sync once per session to prevent infinite loops
  //     if (hasSyncedVegMode.current) return;
  //     
  //     const syncVegMode = async () => {
  //       try {
  //         // First, sync the manual Veg Mode setting
  //         const savedVegMode = await AsyncStorage.getItem('vegMode');
  //         if (savedVegMode !== null) {
  //           const manualVegMode = JSON.parse(savedVegMode);
  //           setVegMode(manualVegMode);
  //         }
  //         
  //         // Then check for auto-customize
  //         const savedCustomize = await AsyncStorage.getItem('vegModeCustomize');
  //         const savedSelectedDays = await AsyncStorage.getItem('vegModeSelectedDays');
  //         
  //         if (savedCustomize !== null && JSON.parse(savedCustomize)) {
  //           if (savedSelectedDays !== null) {
  //             const selectedDays = JSON.parse(savedSelectedDays);
  //             const today = new Date().toLocaleDateString('en-US', { weekday: 'lowercase' });
  //             
  //             // If today is in selected days, auto-enable Veg Mode
  //             if (selectedDays[today]) {
  //               setVegMode(true);
  //               await AsyncStorage.setItem('vegMode', JSON.stringify(true));
  //             }
  //           }
  //         }
  //       } catch (error) {
  //         console.log('Error syncing veg mode:', error);
  //       } finally {
  //         hasSyncedVegMode.current = true;
  //       }
  //     };
  //     
  //     syncVegMode();
  //   }, []) // Removed vegMode dependency to prevent infinite loop
  // );

  // Fetch user's college canteens and current canteen name (for switcher)
  useEffect(() => {
    if (!user?.id) return;
    let mounted = true;
    (async () => {
      try {
        const { data: userRow, error: userErr } = await supabase
          .from('users')
          .select('college_id, canteen_id')
          .eq('id', user.id)
          .maybeSingle();
        if (!mounted) return;
        if (userErr) {
          // ✅ error handled
          console.error('Canteen switcher users:', userErr.message || userErr);
          return;
        }
        if (!userRow?.college_id) {
          return;
        }
        const collegeId = userRow.college_id;
        const userCanteenId = userRow.canteen_id || null;

        const { data: canteens, error: cErr } = await supabase
          .from('canteens')
          .select('id, name, is_open')
          .eq('college_id', collegeId)
          .order('name');
        if (!mounted) return;
        if (cErr) {
          console.error('Canteen switcher canteens:', cErr.message || cErr);
          return;
        }
        if (Array.isArray(canteens)) {
          // Picker: only open (active) canteens; closed canteens are not shown or switchable
          const openForSwitcher = canteens.filter((c) => c.is_open !== false);
          setCollegeCanteens(openForSwitcher);

          if (userCanteenId) {
            const current = canteens.find((c) => c.id === userCanteenId);
            if (current) {
              setCurrentCanteenName(current.name);
              setCurrentCanteenId(userCanteenId);
            } else {
              const { data: canteenRow } = await supabase
                .from('canteens')
                .select('name')
                .eq('id', userCanteenId)
                .maybeSingle();
              if (canteenRow) {
                setCurrentCanteenName(canteenRow.name);
                setCurrentCanteenId(userCanteenId);
              }
            }
          } else if (openForSwitcher.length > 0) {
            setCurrentCanteenName(openForSwitcher[0].name);
            setCurrentCanteenId(openForSwitcher[0].id);
          }
        }
      } catch (e) {
        console.log('Canteen switcher load error:', e);
      } finally {
        if (mounted) {
          setMenuCanteenReady(true);
        }
      }
    })();
    return () => { mounted = false; };
  }, [user?.id]);

  // Debounce search input to reduce unnecessary filtering on each keystroke
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    if (!categoriesLoading || menuItems.length === 0 || fallbackCategoriesAppliedRef.current) {
      return;
    }

    const uniqueCategories = new Map();
    const slugify = (text) => String(text || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '');

    menuItems.forEach(item => {
      const categoryName = item.category || item.categories?.name;
      if (!categoryName) {
        return;
      }

      const key = item.category_id || slugify(categoryName);
      if (uniqueCategories.has(key)) {
        return;
      }

      uniqueCategories.set(key, {
        id: item.category_id ? `category-${item.category_id}` : `category-${slugify(categoryName)}`,
        name: categoryName,
        image_url: item.categories?.image_url || null,
        icon: item.categories?.icon || '🍽️',
        sort_order: item.categories?.sort_order ?? 0,
        is_active: true,
      });
    });

    const derivedCategories = Array.from(uniqueCategories.values());
    if (derivedCategories.length === 0) {
      return;
    }

    derivedCategories.sort((a, b) => {
      if (a.sort_order !== b.sort_order) {
        return a.sort_order - b.sort_order;
      }
      return a.name.localeCompare(b.name);
    });

    fallbackCategoriesAppliedRef.current = true;
    setCategories(derivedCategories);
    setCategoriesLoading(false);
    AsyncStorage.setItem(CATEGORIES_CACHE_KEY, JSON.stringify(derivedCategories)).catch((cacheError) => {
      console.log('Error caching fallback categories:', cacheError);
    });
  }, [categoriesLoading, menuItems]);



  // Pull to refresh function
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      reloadMenuFromStart(),
      fetchCategories(),
      checkCanteenStatus(),
    ]);
    setRefreshing(false);
  };

  // Scroll to top function
  const scrollToTop = useCallback(() => {
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  }, []);

  // Helper function to check if an item is a beverage (must be defined before use)
  function isItemBeverage(item) {
    const itemCategory = item.category?.toLowerCase() || '';
    const itemName = item.name?.toLowerCase() || '';
    const itemDescription = item.description?.toLowerCase() || '';
    
    return itemCategory.includes('beverage') || 
           itemName.includes('beverage') ||
           itemDescription.includes('beverage') ||
           itemName.includes('drink') ||
           itemDescription.includes('drink') ||
           itemName.includes('juice') ||
           itemDescription.includes('juice') ||
           itemName.includes('coffee') ||
           itemDescription.includes('coffee') ||
           itemName.includes('tea') ||
           itemDescription.includes('tea') ||
           itemName.includes('soda') ||
           itemDescription.includes('soda') ||
           itemName.includes('cola') ||
           itemDescription.includes('cola') ||
           itemName.includes('water') ||
           itemDescription.includes('water');
  }

  // Apply time-based sorting to filtered items
  const filteredItems = useMemo(() => {
    // Safety check for menuItems
    if (!Array.isArray(menuItems) || menuItems.length === 0) {
      return [];
    }
    
    // First filter the items
    const filtered = menuItems.filter(item => {
      // Safety check for item
      if (!item || !item.name) {
        return false;
      }
      // Keep unavailable items visible; only filter by quick action/search
      let matchesFilter = true;
      
      // Handle dynamic category filtering
      if (activeFilter.startsWith('category-')) {
        // Extract category name from filter ID
        const categoryName = activeFilter.replace('category-', '');
        
        // Find the category from the categories list
        if (categoryName && categoryName !== 'all') {
          const selectedCategory = Array.isArray(categories) ? 
            categories.find(cat => cat && cat.name && cat.name.toLowerCase() === categoryName) : 
            null;
          
          if (selectedCategory) {
            // Primary match: Check if item's category_id matches the selected category's id
            matchesFilter = item.category_id === selectedCategory.id;
            
            // Secondary match: Check if item's category name matches (fallback)
            if (!matchesFilter) {
              matchesFilter = item.category?.toLowerCase() === categoryName;
            }
          } else {
            // Fallback to name matching if category not found
            matchesFilter = item.category?.toLowerCase() === categoryName;
          }
        }
      } else {
        // Handle legacy hardcoded filters
        switch (activeFilter) {
          case 'breakfast':
            matchesFilter = item.category?.toLowerCase().includes('breakfast') || 
                           item.name.toLowerCase().includes('breakfast') ||
                           item.description.toLowerCase().includes('breakfast');
            break;
          case 'lunch':
            matchesFilter = item.category?.toLowerCase().includes('lunch') || 
                           item.name.toLowerCase().includes('lunch') ||
                           item.description.toLowerCase().includes('lunch');
            break;
          case 'snacks':
            matchesFilter = item.category?.toLowerCase().includes('snack') || 
                           item.name.toLowerCase().includes('snack') ||
                           item.description.toLowerCase().includes('snack');
            break;
          case 'beverages':
            matchesFilter = item.category?.toLowerCase().includes('beverage') || 
                           item.name.toLowerCase().includes('beverage') ||
                           item.description.toLowerCase().includes('beverage') ||
                           item.name.toLowerCase().includes('drink') ||
                           item.description.toLowerCase().includes('drink') ||
                           item.name.toLowerCase().includes('juice') ||
                           item.description.toLowerCase().includes('juice') ||
                           item.name.toLowerCase().includes('coffee') ||
                           item.description.toLowerCase().includes('coffee') ||
                           item.name.toLowerCase().includes('tea') ||
                           item.description.toLowerCase().includes('tea');
            break;
          case 'combos':
            matchesFilter = item.category?.toLowerCase().includes('combo') || 
                           item.name.toLowerCase().includes('combo') ||
                           item.description.toLowerCase().includes('combo') ||
                           item.name.toLowerCase().includes('meal') ||
                           item.description.toLowerCase().includes('meal') ||
                           item.name.toLowerCase().includes('set') ||
                           item.description.toLowerCase().includes('set');
            break;
          case 'vegetarian':
            matchesFilter = item.isVegetarian;
            break;
          case 'all':
            matchesFilter = true; // Show all items
            break;
          default:
            matchesFilter = true; // Show all items when no specific category is selected
        }
      }

      // Apply dietary filter
      let matchesDietary = true;
      switch (dietaryFilter) {
        case 'veg':
          matchesDietary = item.isVegetarian === true;
          break;
        case 'non-veg':
          matchesDietary = item.isVegetarian === false;
          break;
        default:
          matchesDietary = true; // 'all' case
      }

      // Apply Veg Mode filter
      let matchesVegMode = true;
      if (vegMode) {
        matchesVegMode = item.isVegetarian === true;
      }
      
      const normalizedQuery = debouncedSearchQuery.trim().toLowerCase();
      const matchesSearch = normalizedQuery === '' ||
        item.name?.toLowerCase().includes(normalizedQuery) ||
        item.description?.toLowerCase().includes(normalizedQuery) ||
        item.category?.toLowerCase().includes(normalizedQuery) ||
        (Array.isArray(item.ingredients) && item.ingredients.join(' ').toLowerCase().includes(normalizedQuery));
      
      return matchesFilter && matchesDietary && matchesVegMode && matchesSearch;
    });

    // Then apply time-based sorting (only when no specific filter is active)
    let sortedItems = filtered;
    if (activeFilter === 'all' && priceSort === 'none') {
      // Apply time-based sorting when no other sorting is active
      sortedItems = sortItemsByTime(filtered);
      
      // Log time-based sorting info for debugging (disabled for performance)
      // if (sortedItems.length > 0) {
      //   const timeInfo = getTimeSortingInfo();
      //   console.log('🕐 Time-based sorting active:', {
      //     currentTime: timeInfo.currentTime,
      //     timePeriod: timeInfo.timePeriod,
      //     priorityCategory: timeInfo.priorityCategory,
      //     totalItems: sortedItems.length,
      //     firstItemCategory: sortedItems[0]?.category
      //   });
      // }
    } else {
      // Apply existing sorting logic when filters are active
      console.log(`🔍 Applying category sorting for filter: ${activeFilter}`);
      sortedItems = filtered.sort((a, b) => {
        // First apply price sorting if active
        if (priceSort === 'low-to-high') {
          if (a.price !== b.price) return a.price - b.price;
        } else if (priceSort === 'high-to-low') {
          if (a.price !== b.price) return b.price - a.price;
        }

        // Then prioritize name matches first (prefix > contains), then other fields, then availability
        const q = debouncedSearchQuery.trim().toLowerCase();
        const scoreFor = (item) => {
          if (!q) return 0;
          const name = String(item.name || '').toLowerCase();
          if (name.startsWith(q)) return 3;
          if (name.includes(q)) return 2;
          const otherBucket = [
            String(item.description || '').toLowerCase(),
            String(item.category || '').toLowerCase(),
            Array.isArray(item.ingredients) ? item.ingredients.join(' ').toLowerCase() : ''
          ].join(' ');
          return otherBucket.includes(q) ? 1 : 0;
        };

        const scoreA = scoreFor(a);
        const scoreB = scoreFor(b);
        if (scoreB !== scoreA) return scoreB - scoreA;

        // Check if items are beverages (beverages should be at bottom)
        const isBeverageA = isItemBeverage(a);
        const isBeverageB = isItemBeverage(b);
        if (isBeverageA !== isBeverageB) {
          return isBeverageA ? 1 : -1; // beverages at bottom
        }

        // For Breakfast category, prioritize available items first, then out of stock at bottom
        if (activeFilter === 'category-breakfast') {
          // First priority: Available items come first
          if (a.isAvailable !== b.isAvailable) {
            console.log(`🔄 Breakfast sorting: ${a.name} (${a.isAvailable ? 'available' : 'out of stock'}) vs ${b.name} (${b.isAvailable ? 'available' : 'out of stock'})`);
            return a.isAvailable ? -1 : 1; // available first
          }
          
          // Second priority: If both have same availability, sort by name alphabetically
          return a.name.localeCompare(b.name);
        } else {
          // For other categories, maintain current availability sorting
          if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1; // available first
        }
        
        return 0;
      });
      
      // Debug: Show final sorted order for breakfast category
      if (activeFilter === 'category-breakfast') {
        console.log('🍳 Final breakfast items order:', sortedItems.map(item => ({
          name: item.name,
          isAvailable: item.isAvailable,
          price: item.price
        })));
      }
    }

    return sortedItems;
  }, [menuItems, activeFilter, dietaryFilter, debouncedSearchQuery, priceSort, vegMode]);

  // Veg / search / category filters are client-side — keep fetching pages until something matches or catalog ends.
  useEffect(() => {
    if (loading || loadingMore || !hasMore || pagingInFlightRef.current) return;
    if (filteredItems.length > 0) return;
    if (menuItems.length === 0) return;
    if (menuAutoPrefetchSafetyRef.current >= 50) return;
    menuAutoPrefetchSafetyRef.current += 1;
    fetchMenuNextPage();
  }, [
    loading,
    loadingMore,
    hasMore,
    filteredItems.length,
    menuItems.length,
    fetchMenuNextPage,
  ]);

  const handleMenuEndReached = useCallback(() => {
    fetchMenuNextPage();
  }, [fetchMenuNextPage]);

  const handleAddToCart = useCallback((item) => {
    // Block only when the server has confirmed kitchen is closed
    if (kitchenConfirmedClosed) {
      Alert.alert(
        'Canteen Closed',
        'Sorry, the canteen is currently closed. You cannot add items to cart.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (!item.isAvailable) {
      Alert.alert('Out of Stock', 'This item is currently out of stock.');
      return;
    }
    
    // Avoid re-render storm by deferring cart update slightly
    requestAnimationFrame(() => addToCart(item));

    // Show snackbar after 200ms
    setTimeout(() => {
      setSnackbarVisible(true);
      // Auto hide after 5s
      if (snackbarHideTimer.current) {
        clearTimeout(snackbarHideTimer.current);
      }
      snackbarHideTimer.current = setTimeout(() => {
        setSnackbarVisible(false);
      }, 5000);
    }, 200);
  }, [addToCart, kitchenConfirmedClosed]);

  const handleQuickActionPress = useCallback((filter) => {
    setActiveFilter(filter);
    // Smooth scale-up animation on select
    if (!categoryScales[filter]) {
      categoryScales[filter] = new Animated.Value(1);
    }
    Animated.sequence([
      Animated.timing(categoryScales[filter], {
        toValue: 1.06,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.spring(categoryScales[filter], {
        toValue: 1,
        useNativeDriver: true,
        tension: 120,
        friction: 8,
      }),
    ]).start();
  }, []);

  const handleSearchSubmit = () => {
    // Search functionality is handled in the filter
  };

  const renderQuickAction = useCallback(({ item }) => {
    const isActive = activeFilter === item.filter;
    if (!categoryScales[item.filter]) {
      categoryScales[item.filter] = new Animated.Value(1);
    }
    const scale = categoryScales[item.filter];

    const hasValidImage =
      item.image_url &&
      item.image_url.trim() !== '' &&
      !item.image_url.includes('placeholder') &&
      !item.image_url.includes('default') &&
      !item.image_url.includes('restaurant-outline');

    return (
      <View style={styles.quickActionContainer}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <TouchableOpacity
            onPress={() => handleQuickActionPress(item.filter)}
            style={[
              styles.quickActionButton,
              {
                backgroundColor: 'transparent',
                borderWidth: isActive ? 2 : 0,
                borderColor: isActive ? '#D4A017' : 'transparent',
              },
            ]}
            activeOpacity={0.78}
          >
            <View style={styles.quickActionIconContainer}>
              {hasValidImage ? (
                <Image
                  source={{ uri: item.image_url }}
                  style={styles.quickActionImage}
                  resizeMode="cover"
                />
              ) : item.icon ? (
                <Text style={styles.quickActionEmoji}>{item.icon}</Text>
              ) : (
                <AppIcon
                  name="restaurant"
                  size={22}
                  color={isActive ? '#D4A017' : colors.textSecondary}
                />
              )}
            </View>
          </TouchableOpacity>
        </Animated.View>
        <Text
          style={[
            styles.quickActionText,
            isActive
              ? { ...getFontStyle('bold'), color: colors.text }
              : { ...getFontStyle('regular'), color: colors.textSecondary },
          ]}
          numberOfLines={1}
        >
          {item.title}
        </Text>
      </View>
    );
  }, [activeFilter, colors, handleQuickActionPress, categoryScales]);

  const renderFoodItem = ({ item }) => {
    // Safety check for item
    if (!item || !item.id) {
      return null;
    }
    
    const qty = getItemQuantity(item.id);
    return (
      <AnimatedFoodCard
        item={item}
        onPress={() => navigation.navigate('ItemDetail', { item })}
        onAddToCart={() => handleAddToCart(item)}
        quantity={qty}
        onIncrease={() => (kitchenConfirmedClosed ? null : increaseQuantity(item.id))}
        onDecrease={() => (kitchenConfirmedClosed ? null : decreaseQuantity(item.id))}
        disabled={kitchenConfirmedClosed}
        vegMode={vegMode}
        imagePriority="normal"
      />
    );
  };

  const searchChrome = useMemo(
    () => ({
      bar: {
        backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.92)' : 'rgba(255, 255, 255, 0.9)',
        borderColor: isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0, 0, 0, 0.1)',
      },
      input: { color: colors.text },
      placeholder: colors.textMuted,
      icon: colors.textTertiary,
      dot: { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.9)' : '#FFFFFF' },
    }),
    [colors, isDarkMode]
  );

  /** Hero banner + search; counter-translates after `pinScrollY` so it freezes with the search bar. */
  const stickyBannerContent = useMemo(
    () => (
      <Animated.View
        style={[
          styles.bannerPinWrapper,
          { 
            backgroundColor: colors.contentBackground,
            opacity: bannerOpacity,
          },
        ]}
      >
        <View style={styles.banner}>
        <FlatList
          ref={bannerFlatListRef}
          data={banners}
          keyExtractor={(b) => b.id}
          horizontal
          snapToInterval={width - 32}
          snapToAlignment="center"
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={3}
          removeClippedSubviews={false}
          getItemLayout={(data, index) => ({
            length: width - 32,
            offset: (width - 32) * index,
            index,
          })}
          renderItem={({ item }) => (
            <View style={{ width: width - 32, height: '100%' }}>
              <Image
                source={item.source}
                style={[styles.bannerImage, { width: width - 32 }]}
                resizeMode="cover"
                onLoad={() => {
                  setBannerLoading((prev) => ({ ...prev, [item.id]: false }));
                }}
                onError={() => {
                  setBannerLoading((prev) => ({ ...prev, [item.id]: false }));
                }}
              />
            </View>
          )}
          onScroll={(e) => {
            // Update dots immediately on scroll for instant feedback
            const x = e.nativeEvent.contentOffset.x;
            const bWidth = width - 32;
            const newIndex = Math.max(0, Math.min(banners.length - 1, Math.floor((x + bWidth / 2) / bWidth)));
            if (newIndex !== activeBannerIndex && newIndex >= 0 && newIndex < banners.length) {
              setActiveBannerIndex(newIndex);
            }
          }}
          onScrollBeginDrag={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            const bWidth = width - 32;
            const newIndex = Math.max(0, Math.min(banners.length - 1, Math.floor((x + bWidth / 2) / bWidth)));
            if (newIndex !== activeBannerIndex) setActiveBannerIndex(newIndex);
          }}
          onScrollEndDrag={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            const bWidth = width - 32;
            const newIndex = Math.max(0, Math.min(banners.length - 1, Math.round(x / bWidth)));
            if (newIndex !== activeBannerIndex) setActiveBannerIndex(newIndex);
          }}
          onMomentumScrollBegin={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            const bWidth = width - 32;
            const newIndex = Math.max(0, Math.min(banners.length - 1, Math.round(x / bWidth)));
            if (newIndex !== activeBannerIndex) setActiveBannerIndex(newIndex);
          }}
          onMomentumScrollEnd={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            const bWidth = width - 32;
            const newIndex = Math.max(0, Math.min(banners.length - 1, Math.round(x / bWidth)));
            if (newIndex !== activeBannerIndex) setActiveBannerIndex(newIndex);
          }}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={{
            itemVisiblePercentThreshold: 50,
          }}
          scrollEventThrottle={1}
        />

        <View style={styles.bannerOverlay}>
          {/* Header text removed - now in Layer 1 FixedHeader */}
        </View>

      </View>
    </Animated.View>
    ),
    [
      colors,
      banners,
      activeBannerIndex,
      width,
      height,
      handleViewableItemsChanged,
    ]
  );

  const scrollableListHeader = useMemo(
    () => (
      <View>
      <View style={styles.quickActionsSection}>
        <FlatList
          data={showCategorySkeleton ? [1, 2, 3, 4, 5] : quickActions}
          renderItem={showCategorySkeleton ? (() => (
            <View style={styles.quickActionContainer}>
              <View style={styles.quickActionButton}>
                <View style={styles.quickActionContent}>
                  <View style={styles.quickActionIconContainer}>
                    <EnhancedLoadingShimmer type="circle" />
                  </View>
                  <View style={styles.categorySkeletonText}>
                    <EnhancedLoadingShimmer type="text" />
                  </View>
                </View>
              </View>
            </View>
          )) : renderQuickAction}
          keyExtractor={(item) => showCategorySkeleton ? `skeleton-${item}` : item.id}
          horizontal
          removeClippedSubviews={false}
          initialNumToRender={showCategorySkeleton ? 5 : quickActions.length}
          maxToRenderPerBatch={showCategorySkeleton ? 5 : quickActions.length}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickActionsList}
          extraData={activeFilter}
        />
      </View>
      
      <View style={styles.exploreItemsSection}>
        <Text style={[
          styles.exploreItemsText,
          { color: vegMode ? '#00BD32' : '#f95a1c' }
        ]}>Explore Items</Text>
      </View>
      </View>
    ),
    [activeFilter, quickActions, showCategorySkeleton, vegMode, renderQuickAction]
  );

  const listHeaderWithStickyBanner = useMemo(
    () => (
      <View>
        {/* Spacer for the fixed header only */}
        <View style={{ height: FIXED_HEADER_HEIGHT }} />
        {stickyBannerContent}
        {/* Gap for the pinned search+categories bar — search starts right after banner */}
        <View style={{ height: SEARCH_BAR_HEIGHT + CATEGORIES_SECTION_HEIGHT }} />
        <View style={styles.exploreItemsSection}>
          <Text style={[
            styles.exploreItemsText,
            { color: vegMode ? '#00BD32' : '#f95a1c' }
          ]}>Explore Items</Text>
        </View>
      </View>
    ),
    [stickyBannerContent, FIXED_HEADER_HEIGHT, SEARCH_BAR_HEIGHT, CATEGORIES_SECTION_HEIGHT, vegMode]
  );

  const renderLoadingItem = () => (
    <View style={styles.loadingContainer}>
      <EnhancedLoadingShimmer type="list" />
    </View>
  );

  // Avoid a second full-screen loader after auth redirect; use in-list shimmer instead.
  const isHoldingForLoad = false;

  // Pulsing logo while holding
  const loadingPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (isHoldingForLoad) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(loadingPulse, { toValue: 1.06, duration: 700, useNativeDriver: true }),
          Animated.timing(loadingPulse, { toValue: 1.0, duration: 700, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [isHoldingForLoad]);

  // Spinner rotation while holding
  const loadingRotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isHoldingForLoad) {
      loadingRotate.setValue(0);
      const spinLoop = Animated.loop(
        Animated.timing(loadingRotate, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
          easing: Easing.linear,
        })
      );
      spinLoop.start();
      return () => spinLoop.stop();
    }
  }, [isHoldingForLoad]);

  if (isHoldingForLoad) {
    const spin = loadingRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    const checkingCanteenOnly = canteenStatus.loading && !loading;
    const holdingHint = checkingCanteenOnly
      ? 'Hang tight—we are checking kitchen hours and availability.'
      : 'Fetching today’s menu and item details for you.';
    return (
      <View style={[styles.container, { backgroundColor: colors.contentBackground }]}>
        <StatusBar
          translucent
          backgroundColor={colors.brandYellow}
          barStyle="dark-content"
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: FIXED_HEADER_OFFSET_TOP,
            backgroundColor: colors.brandYellow,
            zIndex: 99,
          }}
        />
        <View style={[styles.cleanLoadingContainer, { paddingBottom: insets.bottom }]}>
          <Animated.Image
            source={LOADING_MASCOT}
            style={[
              styles.holdingLogo,
              { transform: [{ scale: loadingPulse }] },
            ]}
            resizeMode="contain"
          />
          <Animated.View
            style={[
              styles.holdingSpinner,
              {
                transform: [{ rotate: spin }],
                borderColor: isDarkMode ? colors.brandYellow : '#000000',
                borderTopColor: 'transparent',
              },
            ]}
          />
          <Text style={[styles.holdingHint, { color: colors.textSecondary }]}>
            {holdingHint}
          </Text>
        </View>
      </View>
    );
  }

  // Full closed UI only after server confirms is_open === false (not on fetch/network errors).
  if (!canteenStatus.loading && kitchenConfirmedClosed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.contentBackground }]}>
        <StatusBar backgroundColor={colors.brandYellow} barStyle="dark-content" />
        <View style={{ height: 34, backgroundColor: colors.brandYellow }} />
        <View
          style={
            isDarkMode
              ? {
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.glassBorder,
                }
              : undefined
          }
        >
          <ModernHeader
            logo={CANTEEN_STATUS_LOGO}
            subtitle="Currently Closed"
            style={styles.headerSpaced}
          />
        </View>
        <CanteenClosedMessage
          onRefresh={() => checkCanteenStatus({ showAlertOnFailure: true })}
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.contentBackground }]}> 
      <StatusBar
        translucent
        backgroundColor={colors.brandYellow}
        barStyle="dark-content"
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: FIXED_HEADER_OFFSET_TOP,
          backgroundColor: colors.brandYellow,
          zIndex: 99,
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : -50}
      >
        {/* Layer 1: Fixed Persistent Header */}
        <View
          style={[
            styles.fixedHeader,
            {
              top: FIXED_HEADER_OFFSET_TOP,
              paddingTop: 0,
              backgroundColor: colors.contentBackground,
            },
          ]}
        >
          <View style={styles.fixedHeaderContent}>
            <View>
              <View style={styles.locationRow}>
                <AppIcon name="location" size={14} color={isDarkMode ? '#FFFFFF' : '#000000'} />
                <Text style={[styles.locationText, { color: isDarkMode ? '#FFFFFF' : '#000000' }]}>{firstName || 'IARE'}</Text>
                {currentCanteenName ? (
                  <TouchableOpacity
                    onPress={() => collegeCanteens.length > 1 ? setShowCanteenPicker(true) : undefined}
                    style={[styles.canteenSmallSelector, { backgroundColor: '#F5B041', borderWidth: 0 }]}
                    activeOpacity={collegeCanteens.length > 1 ? 0.72 : 1}
                  >
                    <AppIcon name="storefront-outline" size={11} color="#FFFFFF" />
                    <Text style={styles.canteenSmallText} numberOfLines={1}>{currentCanteenName}</Text>
                    {collegeCanteens.length > 1 && <AppIcon name="chevron-down" size={11} color="#FFFFFF" />}
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
            <TouchableOpacity
              onPress={handleVegModeToggle}
              activeOpacity={0.92}
              style={{ flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 10 }}
            >
              <View style={{
                width: 58,
                height: 30,
                borderRadius: 15,
                justifyContent: 'center',
                overflow: 'visible',
                shadowColor: vegMode ? '#00B330' : 'transparent',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: vegMode ? 0.75 : 0,
                shadowRadius: vegMode ? 10 : 0,
                elevation: vegMode ? 8 : 0,
              }}>
                <View style={{
                  ...StyleSheet.absoluteFillObject,
                  borderRadius: 15,
                  backgroundColor: isDarkMode ? '#2C2C2E' : '#D8D8D8',
                  overflow: 'hidden',
                }}>
                  <Animated.View style={[
                    StyleSheet.absoluteFill,
                    {
                      borderRadius: 15,
                      backgroundColor: '#00C137',
                      opacity: vegBgOpacity,
                    }
                  ]} />
                </View>
                <Animated.View style={{
                  position: 'absolute',
                  left: 3,
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: '#FFFFFF',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.28,
                  shadowRadius: 4,
                  elevation: 5,
                  justifyContent: 'center',
                  alignItems: 'center',
                  transform: [{
                    translateX: vegDotScale.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 28],
                    })
                  }]
                }}>
                  <AppIcon
                    name="leaf"
                    size={13}
                    color={vegMode ? '#00C137' : '#C0C0C0'}
                  />
                </Animated.View>
              </View>
              <Text style={{
                fontSize: 9,
                fontWeight: '800',
                letterSpacing: 1.2,
                color: vegMode
                  ? '#00C137'
                  : isDarkMode ? '#444446' : '#C0C0C0',
              }}>
                VEG
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Layer 2: Sticky Search + Categories */}
        <Animated.View
          style={[
            styles.stickyCategoriesLayer,
            {
              top: FIXED_HEADER_HEIGHT,
              transform: [{ translateY: scrollY.interpolate({
                inputRange: [0, bannerHeight],
                outputRange: [bannerHeight + 4, 0],
                extrapolate: 'clamp',
              }) }],
              zIndex: 50,
            }
          ]}
        >
          {/* Search bar row */}
          <View style={styles.stickySearchRow}>
            {/* Solid background that fades in as the search bar reaches the pinned state, preventing items from scrolling visibly behind the transparent corners */}
            <Animated.View style={[StyleSheet.absoluteFill, { 
                backgroundColor: colors.contentBackground,
                opacity: scrollY.interpolate({
                  inputRange: [bannerHeight - 28 - 20, bannerHeight - 28],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                })
             }]} />
            <View style={[styles.animatedSearchBar, searchChrome.bar]}>
              <AppIcon name="search" size={20} color={searchChrome.icon} style={styles.searchIcon} />
              <TextInput
                style={[styles.searchInput, searchChrome.input]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleSearchSubmit}
                placeholder={dynamicPlaceholder}
                placeholderTextColor={searchChrome.placeholder}
              />
              {searchQuery?.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearIcon}>
                  <AppIcon name="close-circle" size={18} color={searchChrome.icon} />
                </TouchableOpacity>
              )}
            </View>
          </View>
          {/* Category circles row */}
          <FlatList
            data={showCategorySkeleton ? [1, 2, 3, 4, 5] : quickActions}
            renderItem={showCategorySkeleton ? (() => null) : renderQuickAction}
            keyExtractor={(item) => showCategorySkeleton ? `skeleton-${item}` : item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ backgroundColor: colors.contentBackground }}
            contentContainerStyle={styles.quickActionsList}
            extraData={activeFilter}
          />
        </Animated.View>

        <AnimatedFlatList
          ref={flatListRef}
          data={filteredItems}
          extraData={[cart, loadingMore, filteredItems.length]}
          keyExtractor={(item) =>
            item?.id != null ? String(item.id) : `${item?.name || 'unknown'}-${item?.category || ''}`
          }
          renderItem={renderFoodItem}
          showsVerticalScrollIndicator={false}
          scrollEnabled={filteredItems.length > 0}
          alwaysBounceVertical={filteredItems.length > 0}
          bounces={filteredItems.length > 0}
          overScrollMode={filteredItems.length > 0 ? 'auto' : 'never'}
          onEndReached={handleMenuEndReached}
          onEndReachedThreshold={0.5}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={10}
          ListFooterComponent={
            loadingMore && filteredItems.length > 0 ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true, listener: handleMainListScroll }
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={Platform.OS === 'android' ? [colors.primary] : undefined}
              progressViewOffset={
                Platform.OS === 'android'
                  ? Math.round(insets.top) + FIXED_HEADER_HEIGHT
                  : undefined
              }
            />
          }
          ListHeaderComponent={listHeaderWithStickyBanner}
          ListEmptyComponent={
            loading ? (
              renderLoadingItem()
            ) : loadingMore && menuItems.length > 0 ? (
              <View style={{ paddingVertical: 48, alignItems: 'center', paddingHorizontal: 24 }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ ...getFontStyle('regular'), marginTop: 14, color: colors.textSecondary }}>
                  Loading more items…
                </Text>
              </View>
            ) : menuLoadError ? (
              <View style={[styles.emptyState, { paddingHorizontal: 24 }]}>
                <AppIcon
                  name="cloud-offline-outline"
                  size={52}
                  color={colors.textTertiary}
                  style={{ marginBottom: 14 }}
                />
                <Text style={[styles.emptyStateTitle, { color: colors.text }]}>Menu unavailable</Text>
                <Text
                  style={[styles.emptyStateSubtitle, { color: colors.textSecondary, textAlign: 'center' }]}
                >
                  {menuLoadError}
                </Text>
                <TouchableOpacity
                  onPress={() => reloadMenuFromStart()}
                  style={[styles.emptyStateClearBtn, { marginTop: 18 }]}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.emptyStateClearLabel, { color: colors.brandYellow }]}>Tap to retry</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Image
                  source={NO_ITEMS_EMPTY_ILLUSTRATION}
                  style={{
                    width: '92%',
                    height: height * 0.3,
                    maxHeight: height * 0.38,
                  }}
                  resizeMode="contain"
                />
                <Text style={[styles.emptyStateTitle, { color: colors.text }]}>
                  {debouncedSearchQuery.trim()
                    ? 'No results found'
                    : 'No items found'}
                </Text>
                <Text
                  style={[
                    styles.emptyStateSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  {debouncedSearchQuery.trim()
                    ? 'Nothing matches that search. Try a shorter word, check spelling, or clear the search to see the full menu.'
                    : 'Nothing is listed for this pick yet. Choose another category, open All Items, or come back a little later.'}
                </Text>
                {debouncedSearchQuery.trim() ? (
                  <TouchableOpacity
                    onPress={() => setSearchQuery('')}
                    style={styles.emptyStateClearBtn}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.emptyStateClearLabel, { color: colors.brandYellow }]}>
                      Clear search
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )
          }
          contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
        />

        {/* Price Filter Dropdown */}
      {showPriceDropdown && (
        <View style={[styles.headerPriceDropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Price Sorting Section */}
          <View style={styles.dropdownSection}>
            <Text style={[styles.dropdownSectionTitle, { color: colors.textSecondary }]}>Price Sort</Text>
            
            <TouchableOpacity
              onPress={() => {
                setPriceSort('none');
                setShowPriceDropdown(false);
              }}
              style={[
                styles.priceDropdownItem,
                { backgroundColor: priceSort === 'none' ? colors.primary : 'transparent' }
              ]}
              activeOpacity={0.7}
            >
              <AppIcon 
                name="remove-circle-outline" 
                size={16} 
                color={priceSort === 'none' ? colors.background : colors.text} 
              />
              <Text style={[
                styles.priceDropdownText,
                { color: priceSort === 'none' ? colors.background : colors.text }
              ]}>
                No Sort
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={() => {
                setPriceSort('low-to-high');
                setShowPriceDropdown(false);
              }}
              style={[
                styles.priceDropdownItem,
                { backgroundColor: priceSort === 'low-to-high' ? colors.primary : 'transparent' }
              ]}
              activeOpacity={0.7}
            >
              <AppIcon 
                name="arrow-up" 
                size={16} 
                color={priceSort === 'low-to-high' ? colors.background : colors.text} 
              />
              <Text style={[
                styles.priceDropdownText,
                { color: priceSort === 'low-to-high' ? colors.background : colors.text }
              ]}>
                Low to High
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={() => {
                setPriceSort('high-to-low');
                setShowPriceDropdown(false);
              }}
              style={[
                styles.priceDropdownItem,
                { backgroundColor: priceSort === 'high-to-low' ? colors.primary : 'transparent' }
              ]}
              activeOpacity={0.7}
            >
              <AppIcon 
                name="arrow-down" 
                size={16} 
                color={priceSort === 'high-to-low' ? colors.background : colors.text} 
              />
              <Text style={[
                styles.priceDropdownText,
                { color: priceSort === 'high-to-low' ? colors.background : colors.text }
              ]}>
                High to Low
              </Text>
            </TouchableOpacity>
          </View>

          {/* Dietary Filter Section */}
          <View style={[styles.dropdownDivider, { backgroundColor: colors.border }]} />
          
          <View style={styles.dropdownSection}>
            <Text style={[styles.dropdownSectionTitle, { color: colors.textSecondary }]}>Dietary</Text>
            
            <TouchableOpacity
              onPress={() => {
                setDietaryFilter('all');
                setShowPriceDropdown(false);
              }}
              style={[
                styles.priceDropdownItem,
                { backgroundColor: dietaryFilter === 'all' ? colors.primary : 'transparent' }
              ]}
              activeOpacity={0.7}
            >
              <AppIcon 
                name="apps-outline" 
                size={16} 
                color={dietaryFilter === 'all' ? colors.background : colors.text} 
              />
              <Text style={[
                styles.priceDropdownText,
                { color: dietaryFilter === 'all' ? colors.background : colors.text }
              ]}>
                All
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={() => {
                setDietaryFilter('veg');
                setShowPriceDropdown(false);
              }}
              style={[
                styles.priceDropdownItem,
                { backgroundColor: dietaryFilter === 'veg' ? colors.primary : 'transparent' }
              ]}
              activeOpacity={0.7}
            >
              <AppIcon 
                name="leaf-outline" 
                size={16} 
                color={dietaryFilter === 'veg' ? colors.background : colors.text} 
              />
              <Text style={[
                styles.priceDropdownText,
                { color: dietaryFilter === 'veg' ? colors.background : colors.text }
              ]}>
                Vegetarian
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={() => {
                setDietaryFilter('non-veg');
                setShowPriceDropdown(false);
              }}
              style={[
                styles.priceDropdownItem,
                { backgroundColor: dietaryFilter === 'non-veg' ? colors.primary : 'transparent' }
              ]}
              activeOpacity={0.7}
            >
              <AppIcon 
                name="restaurant-outline" 
                size={16} 
                color={dietaryFilter === 'non-veg' ? colors.background : colors.text} 
              />
              <Text style={[
                styles.priceDropdownText,
                { color: dietaryFilter === 'non-veg' ? colors.background : colors.text }
              ]}>
                Non-Vegetarian
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

        {/* Overlay to close dropdown when clicking outside */}
        {showPriceDropdown && (
          <TouchableOpacity
            style={styles.dropdownOverlay}
            onPress={() => setShowPriceDropdown(false)}
            activeOpacity={1}
          />
        )}
      </KeyboardAvoidingView>

      {/* Canteen picker modal — slide bar of canteens in user's college */}
      <Modal
        visible={showCanteenPicker}
        transparent
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined}
        onRequestClose={() => setShowCanteenPicker(false)}
      >
        <GestureHandlerRootView style={styles.canteenPickerGestureRoot}>
          <View style={styles.canteenPickerModalRoot}>
            {/* Touch target only; must stay under the sheet in z-order */}
            <TouchableWithoutFeedback onPress={() => setShowCanteenPicker(false)}>
              <View style={styles.canteenPickerBackdropFill} />
            </TouchableWithoutFeedback>
            <View
              style={[styles.canteenPickerSheet, { backgroundColor: colors.card }]}
              collapsable={false}
            >
              <View style={[styles.canteenPickerHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.canteenPickerTitle, { color: colors.text }]}>Select canteen</Text>
                <TouchableOpacity onPress={() => setShowCanteenPicker(false)} hitSlop={12} activeOpacity={1}>
                  <AppIcon name="close" size={24} color={colors.text} />
                </TouchableOpacity>
              </View>
              <FlatList
                horizontal
                data={collegeCanteens}
                keyExtractor={(c) => String(c.id)}
                keyboardShouldPersistTaps="always"
                removeClippedSubviews={false}
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.canteenPickerScroll}
                style={styles.canteenPickerList}
                renderItem={({ item: c }) => {
                  const selected =
                    currentCanteenId != null &&
                    String(c.id) === String(currentCanteenId);
                  return (
                    <Pressable
                      onPress={() => handleSelectCanteen(c)}
                      disabled={canteenPickerLoading}
                      style={({ pressed }) => [
                        styles.canteenPickerCard,
                        {
                          backgroundColor: selected ? colors.brandYellow : colors.surface,
                          borderColor: selected ? colors.brandYellow : colors.border,
                          opacity: canteenPickerLoading ? 0.65 : pressed ? 0.92 : 1,
                        },
                      ]}
                    >
                      <AppIcon name="storefront" size={22} color={selected ? '#000000' : colors.text} />
                      <Text style={[styles.canteenPickerCardText, { color: selected ? '#000000' : colors.text }]} numberOfLines={2}>
                        {c.name}
                      </Text>
                    </Pressable>
                  );
                }}
              />
              {canteenPickerLoading && (
                <View style={styles.canteenPickerLoading} pointerEvents="none">
                  <ActivityIndicator size="small" color={colors.brandYellow} />
                </View>
              )}
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>
      
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
  },
  statusBarSpacer: {
    height: Platform.OS === 'android' ? Constants.statusBarHeight : 0,
    backgroundColor: 'transparent',
  },
  keyboardView: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 100,
  },
  fixedHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: width * 0.05,
  },
  fixedHeaderContent: {
    paddingTop: 2,
    paddingBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 60,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 14,
    ...getFontStyle('bold'),
    color: '#D4A017',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  canteenSmallSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(44,62,107,0.18)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    marginLeft: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(44,62,107,0.3)',
  },
  canteenSmallText: {
    fontSize: 12,
    color: '#FFFFFF',
    ...getFontStyle('semiBold'),
  },
  headerVegToggle: {
    position: 'relative',
    height: 32,
    width: 70,
  },
  stickyCategoriesLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 140, // SEARCH_BAR_HEIGHT(56) + CATEGORIES_SECTION_HEIGHT(84)
  },
  stickySearchRow: {
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: width * 0.04,
  },
  activeCategoryIndicator: {
    width: 6,
    height: 3,
    backgroundColor: '#D4A017',
    borderRadius: 2,
    marginTop: 4,
  },
  headerSpaced: {
    paddingTop: pxToPercentY(12),
    paddingBottom: pxToPercentY(10),
  },
  headerTitleLarge: {
    fontSize: 28,
    ...getFontStyle('bold'),
  },
  headerSubtitle: {
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 0,
  },
  bannerPinWrapper: {
    overflow: 'hidden',
  },
  banner: {
    width: width - 32,
    height: (width - 32) * (550 / 1280), // original aspect ratio
    borderRadius: 20,
    marginTop: 8,
    alignSelf: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  bannerDotsContainer: {
    position: 'absolute',
    bottom: height * 0.012,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  bannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  bannerOverlay: {
    position: 'absolute',
    top: 0,
    
    left: 0,
    right: 0,
    bottom: 0,
    padding: width * 0.05, // 5% of screen width
    justifyContent: 'flex-start',
    paddingTop: height * 0.006, // reduce top padding to lift content
  },
    bannerHeader: {
      marginTop: height * 0.08, // Reduced top spacing for banner title
    },
  bannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: pxToPercentY(4),
  },
  bannerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  bannerSubtitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 5, // Ensure container is above other elements
  },
  bannerSubtitleRow: {
    gap: 4,
    marginTop: pxToPercentY(2),
  },
  bannerLocationIcon: {
    marginRight: 0,
  },
  bannerSubtitle: {
    fontSize: width * 0.058,
    textTransform: 'uppercase',
    letterSpacing: 1,
    ...getFontStyle('semiBold'),
    color: '#D4A017', // Dark yellow color
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  canteenSwitcherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: pxToPercentY(6),
    paddingVertical: pxToPercentY(6),
    paddingHorizontal: 2,
    gap: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  canteenSwitcherPressed: {
    opacity: 0.88,
  },
  canteenSwitcherLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    maxWidth: width * 0.78,
    gap: 4,
  },
  canteenSwitcherText: {
    fontSize: width * 0.042,
    ...getFontStyle('medium'),
    flexShrink: 1,
    minWidth: 0,
  },
  canteenSwitcherChevron: {
    marginTop: 1,
    flexShrink: 0,
  },
  canteenPickerGestureRoot: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  canteenPickerModalRoot: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  canteenPickerBackdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 0,
    elevation: 0,
  },
  canteenPickerList: {
    flexGrow: 0,
    minHeight: 120,
    maxHeight: height * 0.38,
  },
  canteenPickerSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    elevation: 100,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
    maxHeight: height * 0.45,
  },
  canteenPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  canteenPickerTitle: {
    fontSize: 18,
    ...getFontStyle('semiBold'),
  },
  canteenPickerScroll: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  canteenPickerCard: {
    width: width * 0.4,
    minHeight: 80,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    justifyContent: 'center',
    marginRight: 12,
  },
  canteenPickerCardText: {
    fontSize: 14,
    ...getFontStyle('semiBold'),
    marginTop: 6,
  },
  canteenPickerLoading: {
    padding: 12,
    alignItems: 'center',
  },
  bannerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: height * 0.031, // 3.1% of screen height
    marginBottom: 0,
  },
  searchBarContainer: {
    flex: 1,
    marginRight: 0,
  },
  bannerSearchBar: {
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
    height: 25,
    width: '100%',
  },
  animatedSearchBar: {
    position: 'relative',
    height: height * 0.062, // 6.2% of screen height
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: height * 0.031, // 3.1% of screen height
    paddingHorizontal: width * 0.05, // 5% of screen width
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  searchInput: {
    fontSize: width * 0.04, // 4% of screen width
    ...getFontStyle('regular'),
    color: '#000000',
    height: '100%',
    paddingVertical: 0,
    textAlignVertical: 'center',
    flex: 1,
    paddingLeft: width * 0.075, // 7.5% of screen width
    paddingRight: width * 0.05, // 5% of screen width
  },
  searchIcon: {
    position: 'absolute',
    left: width * 0.0375, // 3.75% of screen width
    top: '50%',
    transform: [{ translateY: -height * 0.0125 }], // -1.25% of screen height
    zIndex: 1,
  },
  clearIcon: {
    position: 'absolute',
    right: width * 0.0375,
    top: '50%',
    transform: [{ translateY: -height * 0.0125 }],
    padding: 4,
    paddingBottom: 2,
    zIndex: 2,
  },
  filterIcon: {
    position: 'absolute',
    right: pxToPercentX(16),
    top: pxToPercentY(8),
    padding: 8,
    borderRadius: 16,
  },

  // Removed hero/banner styles

  // Search Bar
  searchBar: {
    marginHorizontal: 0,
    marginTop: pxToPercentY(4),
    marginBottom: pxToPercentY(12),
  },

  // Search Section on Banner (overlay)
  bannerSearchSection: {
    position: 'absolute',
    bottom: height * 0.02, // Position at bottom of banner with some margin
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    paddingVertical: height * 0.02, // 2% of screen height
    paddingHorizontal: width * 0.05, // 5% of screen width
  },
  // Quick Actions Section
  quickActionsSection: {
    marginTop: -height * 0.012,
    marginBottom: height * 0.01, // 1% of screen height
    backgroundColor: 'transparent',
    paddingVertical: height * 0.02, // 2% of screen height
  },
  exploreItemsSection: {
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: width * 0.05,
  },
  exploreItemsText: {
    fontSize: 18,
    ...getFontStyle('bold'),
    color: '#E65100', // Vibrant deep orange
    textAlign: 'left',
  },
  quickActionsList: {
    paddingHorizontal: width * 0.01,
    paddingTop: 4,
    paddingBottom: 8,
    alignItems: 'center',
  },

  // Pill / chip styles for category filters
  quickActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 50,
    borderWidth: 1,
    marginHorizontal: 4,
    gap: 7,
    // subtle depth
    shadowColor: '#D4A017',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
  },
  quickActionChipImage: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
  },
  quickActionChipEmoji: {
    fontSize: 17,
    lineHeight: 21,
  },
  quickActionChipText: {
    fontSize: width * 0.034,
    letterSpacing: 0.1,
    maxWidth: width * 0.35,
  },
  
  // Skeleton loader styles for categories
  categorySkeletonText: {
    height: 12,
    width: 60,
    borderRadius: 4,
    marginTop: 4,
    overflow: 'hidden',
  },

  
  
  // Header Container for buttons
  headerContainer: {
    position: 'relative',
  },
  // Custom Veg Mode Toggle Switch
  vegModeContainer: {
    // Position is now handled by bannerControls flexbox
  },
  customVegToggle: {
    width: width * 0.175, // 17.5% of screen width
    height: height * 0.044, // 4.4% of screen height
    position: 'absolute',
    right: width * 0.005, // 0.5% of screen width
    top: -height * 0.001, // Reduced top spacing
    marginTop: height * 0.008, // lift toggle slightly
  },
  vegToggleBackground: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: width * 0.02, // 2% of screen width
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  vegToggleText: {
    width: '50%',
    height: '71%',
    position: 'absolute',
    left: '2.9%',
    top: '14.3%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vegToggleVegText: {
    color: 'black',
    fontSize: width * 0.0275, // 2.75% of screen width
    ...getFontStyle('bold'),
    lineHeight: width * 0.0325, // 3.25% of screen width
    textAlign: 'center',
  },
  vegToggleModeText: {
    color: 'black',
    fontSize: width * 0.0275, // 2.75% of screen width
    ...getFontStyle('regular'),
    lineHeight: width * 0.0325, // 3.25% of screen width
    textAlign: 'center',
  },
  vegToggleSwitch: {
    width: '31.4%',
    height: '62.9%',
    position: 'absolute',
    left: '60%',
    top: '18.6%',
    backgroundColor: 'white',
    borderRadius: width * 0.02, // 2% of screen width
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  vegToggleDot: {
    width: '45.5%',
    height: '45.5%',
    backgroundColor: '#00BD32',
    borderRadius: 9999,
  },
  headerPriceDropdown: {
    position: 'absolute',
    right: pxToPercentX(16),
    top: pxToPercentY(50), // Below the filter button
    width: 160, // Increased width for dietary options
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 1001,
    overflow: 'hidden',
  },
  dropdownSection: {
    paddingVertical: 8,
  },
  dropdownSectionTitle: {
    fontSize: 12,
    ...getFontStyle('semiBold'),
    paddingHorizontal: 16,
    paddingVertical: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dropdownDivider: {
    height: 1,
    marginHorizontal: 8,
  },
  priceDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  priceDropdownText: {
    fontSize: 14,
    ...getFontStyle('medium'),
  },
  dropdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 999,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dropdown: {
    position: 'absolute',
    top: 0,
    right: pxToPercentX(16),
    marginTop: pxToPercentY(6),
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 6,
    width: 220,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  separator: {
    height: 1,
    marginVertical: 4,
    backgroundColor: '#E5E7EB',
  },
  filtersContainer: {
    gap: 8,
    marginTop: 6,
  },
  sortLabel: {
    fontSize: 12,
    ...getFontStyle('semiBold'),
  },
  sortButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 12,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  rangeInput: {
    minWidth: 64,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  dietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.2)',
    padding: 24,
    justifyContent: 'center',
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    ...getFontStyle('bold'),
    marginBottom: pxToPercentY(12),
  },
  modalRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: pxToPercentY(12),
  },
  modalInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // Recent section removed styles

  // Menu Section
  menuSection: {
    marginBottom: pxToPercentY(8),
  },
  // itemCount removed
  menuItemsList: {
    paddingHorizontal: 8,
    paddingBottom: 0,
  },

  // Loading States
  loadingContainer: {
    paddingHorizontal: 16,
  },
  loadingShimmer: {
    height: 280,
    marginBottom: 16,
  },

  // Empty State
  emptyState: {
    marginHorizontal: 6,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
  emptyStateTitle: {
    fontSize: 22,
    marginTop: 6,
    marginBottom: 6,
    textAlign: 'center',
    letterSpacing: 0.35,
    lineHeight: 30,
    fontFamily: appTypography.bold,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    ...getFontStyle('regular'),
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 4,
    paddingHorizontal: 18,
    maxWidth: 340,
  },
  emptyStateClearBtn: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  emptyStateClearLabel: {
    fontSize: 15,
    ...getFontStyle('semiBold'),
  },

  // Trendy Demo Section
  trendyDemoSection: {
    marginHorizontal: 16,
    marginBottom: 24,
  },
  trendyDemoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  trendyDemoItem: {
    alignItems: 'center',
    width: '48%', // Adjust as needed for two items
  },
  demoLabel: {
    fontSize: 14,
    marginBottom: 8,
    textAlign: 'center',
  },
  demoProgress: {
    width: '100%',
    height: 10,
    borderRadius: 5,
  },



  // Quick Actions Styles — circle design
  quickActionContainer: {
    alignItems: 'center',
    marginHorizontal: width * 0.006,
    width: 56,
  },
  quickActionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  quickActionContent: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  quickActionIcon: {
    fontSize: 28,
    textAlign: 'center',
  },
  quickActionIconContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FBF3E0',
  },
  quickActionImage: {
    width: '100%',
    height: '100%',
  },
  quickActionEmoji: {
    fontSize: 27,
    textAlign: 'center',
    lineHeight: 32,
  },
  quickActionText: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 5,
    width: '100%',
  },
  loadingScroll: {
    paddingHorizontal: width * 0.05,
    paddingBottom: height * 0.03,
  },
  loadingBanner: {
    height: height * 0.24,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: height * 0.02,
    backgroundColor: '#EDEDED',
  },
  loadingChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: height * 0.02,
  },
  loadingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: '#F3F3F3',
  },
  loadingChipIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    marginRight: 8,
  },
  loadingChipText: {
    width: 60,
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  loadingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  loadingCard: {
    width: (width * 0.9 - 12) / 2,
    height: height * 0.22,
    borderRadius: 16,
    backgroundColor: '#F1F1F1',
    overflow: 'hidden',
    marginBottom: 12,
  },
  loadingCardText: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    height: 24,
  },
  cleanLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  holdingLogo: {
    width: width * 0.42,
    height: width * 0.42,
    maxHeight: 280,
    maxWidth: 280,
    marginBottom: 20,
  },
  holdingHint: {
    marginTop: 22,
    fontSize: 15,
    textAlign: 'center',
    ...getFontStyle('regular'),
  },
  holdingSpinner: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 4,
  },
});

export default HomeScreen;