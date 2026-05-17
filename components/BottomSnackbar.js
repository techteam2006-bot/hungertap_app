import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BottomSnackbar = ({ visible, onPressViewCart, onHidden }) => {
  const insets = useSafeAreaInsets();
  const [rendered, setRendered] = useState(visible);
  const translateY = useRef(new Animated.Value(100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      // Enter: spring slide-up + fade-in (350ms)
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
      // Exit: ease-in slide-down + fade-out
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 100,
          duration: 250,
          easing: undefined,
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
          paddingBottom: Math.max(insets.bottom, 12),
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.leftRow}>
          <Ionicons name="cart" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.titleText}>1 Item added</Text>
        </View>
        <TouchableOpacity onPress={onPressViewCart} activeOpacity={0.8}>
          <Text style={styles.ctaText}>View Cart →</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 9999,
  },
  content: {
    backgroundColor: '#00B330',
    borderRadius: 12,
    paddingVertical: 12,
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


