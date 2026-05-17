import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../lib/ThemeContext';
import { useAuth } from '../lib/AuthContext';
import { useCart } from '../lib/CartContext';

import HomeScreen from '../screens/HomeScreen';
import CartScreen from '../screens/CartScreen';
import OrdersScreen from '../screens/OrdersScreen';
import ProfileScreen from '../screens/ProfileScreen';

const screenComponents = {
  HomeTab: HomeScreen,
  CartTab: CartScreen,
  OrdersTab: OrdersScreen,
  ProfileTab: ProfileScreen,
};

/**
 * Renders the active main-tab screen. Tab changes are via the tab bar only
 * (horizontal swipe between Home → Cart → Orders → Profile is disabled).
 */
export default function DualScreenTabNavigator({ currentTabName }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { user } = useAuth();
  const { cartItems } = useCart();

  const ScreenComponent = screenComponents[currentTabName];
  if (!ScreenComponent) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.contentBackground }}>
      <ScreenComponent navigation={navigation} user={user} cartItems={cartItems} />
    </View>
  );
}
