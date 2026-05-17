import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useCart } from '../lib/CartContext';
import { useTheme } from '../lib/ThemeContext';

const CartBadgeUpdater = ({ children }) => {
  const { getTotalItems } = useCart();
  const { colors } = useTheme();
  const totalItems = getTotalItems();

  return (
    <View style={styles.container}>
      {children}
      {totalItems > 0 && (
        <View style={[styles.badge, { backgroundColor: colors.error }]}>
          <Text style={[styles.badgeText, { color: colors.background }]}>
            {totalItems > 99 ? '99+' : totalItems}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
});

export default CartBadgeUpdater; 