import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { installGlobalErrorSafety } from './lib/installGlobalErrorSafety';
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import {
  Animated,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import NotificationService, { areUserNotificationsEnabled } from './lib/NotificationService';
import { registerForPushNotificationsAsync, setupForegroundHandler } from './lib/services/notifications';
import { backgroundTaskService } from './lib/BackgroundTaskService';

import FeedbackScreen from './screens/FeedbackScreen';
import SupportScreen from './screens/SupportScreen';
import ContactUsScreen from './screens/ContactUsScreen';
import PrivacyPolicyScreen from './screens/PrivacyPolicyScreen';
import TermsOfServiceScreen from './screens/TermsOfServiceScreen';
import LegalitiesScreen from './screens/LegalitiesScreen';
import LegalWebViewScreen from './screens/LegalWebViewScreen';
import { supabase } from './lib/supabase';
import { configureImageCache } from './lib/ImageCache';
import AppErrorBoundary from './components/AppErrorBoundary';
import { getOrderStatusNotificationBody, isNotifiableOrderStatus } from './lib/orderStatus';

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
  const { user, userRole, isSignedIn, isLoaded, pendingSignupCompletion, pendingPasswordReset } = useAuth();
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
  
  // CRITICAL: Only allow 'student' role to access the app
  // Block 'canteen_admin' and 'super_admin' roles
  // Keep guest stack during mid-signup / password-reset OTP flows
  const isStudentUser =
    isSignedIn &&
    user &&
    userRole === 'student' &&
    !pendingSignupCompletion &&
    !pendingPasswordReset;
  
  // Determine initial route
  const getInitialRoute = () => {
    if (isCheckingSplash) return null; // Wait for check to complete
    if (isStudentUser) return "MainTabs"; // Only allow students
    if (!hasShownSplash) return "Splash";
    return "Login";
  };
  
  if (isCheckingSplash) {
    return <GlobalLoading />;
  }
  
  return (
    <Stack.Navigator
      key={isStudentUser ? 'auth' : 'guest'}
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
      {!isStudentUser ? (
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
          {/* Only students can access these screens */}
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

    // Handle notification taps
    const handleNotificationResponse = (response) => {
      const data = response.notification.request.content.data;
      console.log('📱 Notification tapped:', data);
      
      // Handle different notification types
      if (data.type === 'order_placed') {
        // Navigate to order status if user is authenticated
        if (user) {
          // This would navigate to the order status screen
          console.log('🎯 Would navigate to order status for order:', data.orderId);
        }
      } else if (data.type === 'order_status') {
        // Navigate to order status screen
        if (user) {
          console.log('🎯 Would navigate to order status update for order:', data.orderId);
        }
      }
    };

    // Set up notification listeners
    const notificationResponseListener = NotificationService.addNotificationResponseReceivedListener(handleNotificationResponse);

    // Subscribe to order status changes via Realtime
    const subscribeToOrderStatus = () => {
      if (!user?.id) return null;

      console.log('🔔 Setting up order status subscription for user:', user.id);
      
      const channel = supabase
        .channel('order_status_updates')
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `placed_by=eq.${user.id}`,
        }, async (payload) => {
          // ✅ error handled — Realtime payloads must never reject the subscription
          try {
            console.log('📦 Order status update received:', payload);

            const newOrder = payload?.new ?? null;
            const oldOrder = payload?.old ?? null;
            if (!newOrder || !oldOrder) return;

            if (
              newOrder.status === oldOrder.status ||
              !isNotifiableOrderStatus(newOrder.status)
            ) {
              return;
            }

            if (!(await areUserNotificationsEnabled())) {
              return;
            }

            console.log('🔔 Sending local notification for status:', newOrder.status);

            let itemSummary = '';
            try {
              const { data: lines } = await supabase
                .from('order_items')
                .select('quantity, items ( name )')
                .eq('order_id', newOrder.id);
              if (Array.isArray(lines) && lines.length) {
                itemSummary = lines
                  .map((row) => {
                    const name = row?.items?.name || 'Item';
                    const qty = Number(row?.quantity) || 1;
                    return qty > 1 ? `${name} (x${qty})` : name;
                  })
                  .filter(Boolean)
                  .join(', ');
              }
            } catch (itemErr) {
              console.log('Order item names for notification:', itemErr?.message || itemErr);
            }

            const orderToken = newOrder.order_token;
            const title = orderToken ? `📦 Order #${orderToken}` : '📦 Your order';

            await Notifications.scheduleNotificationAsync({
              content: {
                title,
                body: getOrderStatusNotificationBody(newOrder.status, itemSummary),
                data: {
                  orderId: newOrder.id,
                  order_token: orderToken,
                  status: newOrder.status,
                  type: 'order_status',
                },
                sound: true,
                ...(Platform.OS === 'android' ? { channelId: 'orders' } : {}),
              },
              trigger: null,
            });
          } catch (e) {
            console.error('Order status realtime notification:', e?.message || e);
          }
        })
        .subscribe();

      return channel;
    };

    // Initialize notifications and subscribe to order updates
    initializeNotifications();
    maybeRegisterPushToken();
    const orderChannel = subscribeToOrderStatus();

    // Initialize background task service for cart timeout management
    const initializeBackgroundTasks = async () => {
      try {
        await backgroundTaskService.initialize();
        console.log('✅ Background task service initialized');
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
      if (orderChannel) {
        supabase.removeChannel(orderChannel);
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