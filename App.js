import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { installGlobalErrorSafety } from './lib/installGlobalErrorSafety';
import React, { useEffect, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import {
  Animated,
  AppState,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export const navigationRef = createNavigationContainerRef();
import { appTypography } from './lib/darkThemeConfig';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { loadFonts } from './lib/utils/fonts';
// Ensure Animated is available globally for any libs that expect global.Animated
if (typeof global !== 'undefined' && !global.Animated) {
  global.Animated = Animated;
}

(function applyGlobalAppFont() {
  const base = { fontFamily: appTypography.regular };
  const merge = (Component) => {
    const prev = Component.defaultProps?.style;
    Component.defaultProps = {
      ...(Component.defaultProps || {}),
      style: StyleSheet.flatten([base, prev]),
    };
  };
  merge(Text);
  merge(TextInput);
})();
import * as Notifications from 'expo-notifications';
import AppIcon from './components/AppIcon';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSplashShown, getNotificationsEnabled, setNotificationsEnabled, preloadSettingsCache } from './lib/settingsCache';

// Screens
import HomeScreen from './screens/HomeScreen';
import CartScreen from './screens/CartScreen';
import OrdersScreen from './screens/OrdersScreen';
import ProfileScreen from './screens/ProfileScreen';
import DualScreenTabNavigator from './components/DualScreenTabNavigator';
import LoginScreen from './screens/LoginScreen';
import SplashScreen from './screens/SplashScreen';
import AuthLoadingScreen from './screens/AuthLoadingScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import ItemDetailScreen from './screens/ItemDetailScreen';
import OrderConfirmationScreen from './screens/OrderConfirmationScreen';
import PaymentProcessingScreen from './screens/PaymentProcessingScreen';
import OrderStatusScreen from './screens/OrderStatusScreen';
import FavoritesScreen from './screens/FavoritesHomeScreen';

// Context Providers
// Auth handled by Supabase now (Clerk removed)
import { AuthProvider, useAuth } from './lib/AuthContext';
import { CartProvider } from './lib/CartContext';
import { ThemeProvider, useTheme } from './lib/ThemeContext';
import { FavoritesProvider } from './lib/FavoritesContext';
import { CanteenStatusProvider, useCanteenStatus } from './lib/CanteenStatusContext';
import CartBadgeUpdater from './components/CartBadgeUpdater';
import AuthHelpScreen from './screens/AuthHelpScreen';
import NotificationService from './lib/NotificationService';
import {
  registerForPushNotificationsAsync,
  setupForegroundHandler,
  updatePushTokenStatusInSupabase,
  setupPushTokenRefreshListener,
} from './lib/services/notifications';
import { backgroundTaskService } from './lib/BackgroundTaskService';

import FeedbackScreen from './screens/FeedbackScreen';
import SupportScreen from './screens/SupportScreen';
import ContactUsScreen from './screens/ContactUsScreen';
import PrivacyPolicyScreen from './screens/PrivacyPolicyScreen';
import TermsOfServiceScreen from './screens/TermsOfServiceScreen';
import LegalitiesScreen from './screens/LegalitiesScreen';
import LegalWebViewScreen from './screens/LegalWebViewScreen';
import RestoreAccountScreen from './screens/RestoreAccountScreen';
import { configureImageCache } from './lib/ImageCache';
import AppErrorBoundary from './components/AppErrorBoundary';

installGlobalErrorSafety();

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

import Constants from 'expo-constants';
const isExpoGo = Constants.appOwnership === 'expo';

if (!isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

// Stable wrapper components for each tab to avoid inline function warnings
const HomeTabWrapper = ({ navigation }) => <DualScreenTabNavigator currentTabName="HomeTab" navigation={navigation} />;
const CartTabWrapper = ({ navigation }) => <DualScreenTabNavigator currentTabName="CartTab" navigation={navigation} />;
const OrdersTabWrapper = ({ navigation }) => <DualScreenTabNavigator currentTabName="OrdersTab" navigation={navigation} />;
const ProfileTabWrapper = ({ navigation }) => <DualScreenTabNavigator currentTabName="ProfileTab" navigation={navigation} />;

function GlobalLoading() {
  // Shown after signup/login while session + profile resolve before MainTabs.
  return <AuthLoadingScreen />;
}

function ThemedFontLoading() {
  // Keep font bootstrap minimal; post-auth uses AuthLoadingScreen.
  return <AuthLoadingScreen />;
}

function MainTabs() {
  const { colors, isDarkMode } = useTheme();
  const { canteenStatus } = useCanteenStatus();
  const insets = useSafeAreaInsets(); // Get safe area insets for proper spacing

  const hideTabBarKitchenClosed =
    !!(canteenStatus.statusKnownFromServer && !canteenStatus.isOpen);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        // Prevent RN from stacking another bottom inset on top of our padding (iOS tall tab).
        safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
        tabBarStyle: hideTabBarKitchenClosed ? {
          display: 'none',
        } : {
          backgroundColor: colors.tabBarBackground,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'ios'
            ? 48 + Math.max(insets.bottom - 8, 6)
            : 56 + Math.max(insets.bottom, 0),
          paddingBottom: Platform.OS === 'ios'
            ? Math.max(insets.bottom - 8, 6)
            : Math.max(insets.bottom, 6),
          paddingTop: Platform.OS === 'ios' ? 4 : 6,
          elevation: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.08,
          shadowRadius: 8,
        },
        tabBarActiveTintColor: colors.brandYellow,
        tabBarInactiveTintColor: colors.tabBarInactive,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarInactiveBackgroundColor: 'transparent',
        tabBarItemStyle: {
          paddingVertical: 0,
          justifyContent: 'center',
        },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeTabWrapper}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <AppIcon name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
        listeners={({ navigation, route }) => ({
          tabPress: (e) => {
            // Prevent default behavior
            e.preventDefault();
            
            // Check if we're already on the HomeTab
            if (route.state?.index === 0) {
              // We're already on home tab, trigger scroll to top
              // This will be handled by the HomeScreen component
              navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
            } else {
              // Navigate to home tab normally
              navigation.navigate('HomeTab');
            }
          },
        })}
      />
      <Tab.Screen
        name="CartTab"
        component={CartTabWrapper}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <CartBadgeUpdater>
              <AppIcon name={focused ? 'cart' : 'cart-outline'} size={size} color={color} />
            </CartBadgeUpdater>
          ),
        }}
      />
      <Tab.Screen
        name="OrdersTab"
        component={OrdersTabWrapper}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <AppIcon name={focused ? 'receipt' : 'receipt-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileTabWrapper}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <AppIcon name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function Navigation() {
  const {
    user,
    userRole,
    isSignedIn,
    isLoaded,
    pendingSignupCompletion,
    pendingPasswordReset,
    accountPendingDeletion,
  } = useAuth();
  const { colors } = useTheme();
  const [hasShownSplash, setHasShownSplash] = React.useState(null);
  const [isCheckingSplash, setIsCheckingSplash] = React.useState(true);
  
  // Check if splash has been shown before
  React.useEffect(() => {
    const checkSplashStatus = async () => {
      try {
        await preloadSettingsCache();
        const splashShown = await getSplashShown();
        setHasShownSplash(splashShown);
      } catch (error) {
        console.log('Error checking splash status:', error);
        setHasShownSplash(false);
      } finally {
        setIsCheckingSplash(false);
      }
    };
    checkSplashStatus();
  }, []);
  
  // Initialize image cache for better performance
  React.useEffect(() => {
    configureImageCache();
  }, []);
  
  // Soft-deleted students only see the restore screen (no MainTabs).
  // Keep guest stack during mid-signup / password-reset OTP flows.
  const isStudentUser =
    isSignedIn &&
    user &&
    userRole === 'student' &&
    !pendingSignupCompletion &&
    !pendingPasswordReset &&
    !accountPendingDeletion;

  const navKey = accountPendingDeletion
    ? 'restore'
    : isStudentUser
      ? 'auth'
      : 'guest';
  
  // Determine initial route
  const getInitialRoute = () => {
    if (isCheckingSplash) return null; // Wait for check to complete
    if (accountPendingDeletion) return 'RestoreAccount';
    if (isStudentUser) return 'MainTabs'; // Only allow active students
    if (!hasShownSplash) return 'Splash';
    return 'Login';
  };
  
  if (isCheckingSplash) {
    return <GlobalLoading />;
  }
  
  return (
    <Stack.Navigator
      key={navKey}
      initialRouteName={getInitialRoute()}
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        animationDuration: 120,
        contentStyle: {
          backgroundColor: colors.contentBackground,
        },
      }}
    >
      {accountPendingDeletion ? (
        <Stack.Screen name="RestoreAccount" component={RestoreAccountScreen} />
      ) : !isStudentUser ? (
        <>
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Legalities" component={LegalitiesScreen} />
          <Stack.Screen name="LegalWebView" component={LegalWebViewScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          <Stack.Screen name="AuthHelp" component={AuthHelpScreen} />
        </>
      ) : (
        <>
          {/* Only active students can access these screens */}
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="ItemDetail" component={ItemDetailScreen} />
          <Stack.Screen name="Favorites" component={FavoritesScreen} />
          <Stack.Screen name="Cart" component={CartScreen} />
          <Stack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} />
          <Stack.Screen name="PaymentProcessing" component={PaymentProcessingScreen} />
          <Stack.Screen name="OrderStatus" component={OrderStatusScreen} />
          <Stack.Screen name="Orders" component={OrdersScreen} />
          <Stack.Screen name="Feedback" component={FeedbackScreen} />
          <Stack.Screen name="Support" component={SupportScreen} />
          <Stack.Screen name="ContactUs" component={ContactUsScreen} />
          <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
          <Stack.Screen name="TermsOfService" component={TermsOfServiceScreen} />
          <Stack.Screen name="Legalities" component={LegalitiesScreen} />
          <Stack.Screen name="LegalWebView" component={LegalWebViewScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

function AppNavigator() {
  const { user, loading, isSignedIn, userId } = useAuth();

  // Motorola & OEM Android Permission Resume Fix: re-check FCM permission when app transitions to active
  useEffect(() => {
    const handleAppStateChange = async (nextAppState) => {
      if (nextAppState === 'active' && user?.id) {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'granted') {
          console.log('🔄 App resumed — retrying FCM token registration (permission granted)');
          await registerForPushNotificationsAsync(user.id);
          await updatePushTokenStatusInSupabase(user.id, true);
        } else if (status === 'denied') {
          await updatePushTokenStatusInSupabase(user.id, false);
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [user?.id]);

  // Subscribe to OS token rotation updates
  useEffect(() => {
    if (!user?.id) return;
    const cleanup = setupPushTokenRefreshListener(user.id);
    return () => {
      if (cleanup) cleanup();
    };
  }, [user?.id]);

  useEffect(() => {
    // show notifications in foreground
    setupForegroundHandler();

    // Initialize notification service
    const initializeNotifications = async () => {
      try {
        await NotificationService.initialize();
        console.log('✅ Notifications initialized in AppNavigator');
        // Local notifications only for Expo Go - no push registration needed
      } catch (error) {
        console.log('❌ Failed to initialize notifications:', error);
      }
    };

    const maybeRegisterPushToken = async () => {
      if (!user?.id) return;
      try {
        // Fresh installs: default ON so native FCM token is registered to user_tokens.fcm_token
        const enabled = await getNotificationsEnabled();
        if (!enabled) return;
        const rawProbe = await AsyncStorage.getItem('notificationsEnabled');
        if (rawProbe === null) {
          await setNotificationsEnabled(true);
        }
        const { token } = await registerForPushNotificationsAsync(user.id);
        if (!token) {
          console.log('⚠️ Push registration returned no token (permission or device)');
        } else {
          console.log('✅ FCM token saved to user_tokens.fcm_token');
        }
      } catch (error) {
        console.log('⚠️ Push token registration skipped:', error?.message || error);
      }
    };

    // Handle notification taps with deep-linking via navigationRef
    const handleNotificationResponse = (response) => {
      const data = response?.notification?.request?.content?.data || {};
      console.log('📱 Notification tapped:', data);

      if (navigationRef.isReady()) {
        const orderId = data.orderId || data.order_id;
        const orderToken = data.order_token || data.orderToken;
        if (orderId || orderToken) {
          console.log('🎯 Notification tap navigating to OrderStatus:', { orderId, order_token: orderToken });
          navigationRef.navigate('OrderStatus', { orderId, order_token: orderToken });
        } else {
          console.log('🎯 Notification tap navigating to Orders screen');
          navigationRef.navigate('Orders');
        }
      }
    };

    // Set up notification listeners
    const notificationResponseListener = NotificationService.addNotificationResponseReceivedListener(handleNotificationResponse);

    // Check cold-start notification tap on app launch
    NotificationService.getLastNotificationResponse().then((initialResponse) => {
      if (initialResponse) {
        console.log('🚀 Cold-start notification tap detected:', initialResponse);
        setTimeout(() => handleNotificationResponse(initialResponse), 600);
      }
    });

    // Initialize notifications
    initializeNotifications();
    maybeRegisterPushToken();

    // Initialize background task service for cart timeout management
    const initializeBackgroundTasks = async () => {
      try {
        const ok = await backgroundTaskService.initialize();
        if (ok) {
          console.log('✅ Background task service initialized');
        }
      } catch (error) {
        console.log('❌ Failed to initialize background task service:', error);
      }
    };

    initializeBackgroundTasks();

    // Handle deep linking for auth redirects (email OTP / recovery)
    const handleDeepLink = async ({ url }) => {
      try {
        // ✅ error handled — malformed deep links must not crash startup
        if (!url) return;
        console.log('Deep link handled:', url);

        if (url.includes('/--/login')) {
          try {
            const urlParams = new URL(url);
            const email = urlParams.searchParams.get('email');
            console.log('Auth deep link opened login', email ?? '');
          } catch (parseErr) {
            console.error('Deep link URL parse:', parseErr);
          }
        }
      } catch (e) {
        console.error('handleDeepLink:', e);
      }
    };

    // Set up deep link subscription
    const subscription = Linking.addEventListener('url', (event) => {
      const url = typeof event === 'string' ? event : event?.url;
      if (!url) return;
      handleDeepLink({ url }).catch((e) => console.error('handleDeepLink:', e));
    });
    
    // Check for initial URL
    Linking.getInitialURL()
      .then((url) => {
        // ✅ error handled — initial URL must not reject unhandled
        if (url) {
          handleDeepLink({ url }).catch((e) => console.error('handleDeepLink:', e));
        }
      })
      .catch((e) => console.error('getInitialURL:', e));

    return () => {
      // Clean up subscriptions
      subscription.remove();
      if (notificationResponseListener && notificationResponseListener.remove) {
        notificationResponseListener.remove();
      }
    };
  }, [user, isSignedIn, userId]);

  if (loading) {
    return <GlobalLoading />;
  }

  return (
    <Navigation />
  );
}

export default function App() {
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    // D) JavaScript fatal after React has mounted (temporary probe)
    if (process.env.EXPO_PUBLIC_SENTRY_CRASH_TEST === 'js-fatal') {
      throw new Error('[SentryCrashTest] D: JavaScript fatal exception after React mount');
    }

    const loadAppFonts = async () => {
      try {
        await loadFonts();
        setFontsLoaded(true);
      } catch (error) {
        console.log('Error loading fonts:', error);
        setFontsLoaded(true); // Continue even if fonts fail to load
      }
    };

    loadAppFonts();
  }, []);

  return (
    <SafeAreaProvider>
      {/* Auth must wrap font loading and theme so no subtree ever mounts without a provider. */}
      <AuthProvider>
        <ThemeProvider>
          {!fontsLoaded ? (
            <ThemedFontLoading />
          ) : (
            <CanteenStatusProvider>
              <CartProvider>
                <FavoritesProvider>
                  <AppWithTheme />
                </FavoritesProvider>
              </CartProvider>
            </CanteenStatusProvider>
          )}
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function AppWithTheme() {
  const { colors, isDarkMode } = useTheme();
  
  return (
    <NavigationContainer
      theme={{
        dark: isDarkMode,
        colors: {
          primary: colors.primary,
          background: colors.background,
          card: colors.card,
          text: colors.text,
          border: colors.border,
          notification: colors.primary,
        },
      }}
    >
      <StatusBar
        style={isDarkMode ? 'light' : 'dark'}
        backgroundColor={colors.background}
      />
      <AppErrorBoundary>
        <AppNavigator />
      </AppErrorBoundary>
    </NavigationContainer>
  );
}