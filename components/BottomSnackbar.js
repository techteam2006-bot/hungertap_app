import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Platform } from 'react-native';
import AppIcon from './AppIcon';

/**
 * Sits above the tab bar inside the screen content area.
 * Do not add safe-area bottom padding here — the tab bar already owns the home-indicator inset.
 */
const BottomSnackbar = ({ visible, onPressViewCart, onHidden }) => {
  const [rendered, setRendered] = useState(visible);
  const translateY = useRef(new Animated.Value(100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 120,
          friction: 10,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (rendered) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 100,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setRendered(false);
          if (typeof onHidden === 'function') onHidden();
        }
      });
    }
  }, [visible]);

  if (!rendered) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.content}
        onPress={onPressViewCart}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="View cart"
      >
        <View style={styles.leftRow}>
          <AppIcon name="cart" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.titleText}>1 Item added</Text>
        </View>
        <Text style={styles.ctaText}>View Cart →</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 8,
    zIndex: 9999,
  },
  content: {
    backgroundColor: '#00B330',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textDecorationLine: Platform.OS === 'ios' ? 'none' : 'none',
  },
});

export default BottomSnackbar;
