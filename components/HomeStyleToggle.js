import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { useTheme } from '../lib/ThemeContext';

/**
 * Pill toggle matching HomeScreen veg mode (works consistently on iOS + Android).
 */
export default function HomeStyleToggle({
  value,
  onValueChange,
  disabled = false,
  activeColor = '#00C137',
  width = 58,
  height = 30,
}) {
  const { isDarkMode } = useTheme();
  const dotScale = useRef(new Animated.Value(value ? 1 : 0)).current;
  const bgOpacity = useRef(new Animated.Value(value ? 1 : 0)).current;
  const thumbTravel = width - 24 - 6;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(dotScale, {
        toValue: value ? 1 : 0,
        useNativeDriver: true,
        tension: 120,
        friction: 14,
      }),
      Animated.timing(bgOpacity, {
        toValue: value ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [value, dotScale, bgOpacity]);

  return (
    <TouchableOpacity
      onPress={() => {
        if (disabled) return;
        onValueChange?.(!value);
      }}
      activeOpacity={0.92}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value, disabled: !!disabled }}
    >
      <View style={[styles.track, { width, height, borderRadius: height / 2, opacity: disabled ? 0.5 : 1 }]}>
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: height / 2,
              backgroundColor: isDarkMode ? '#2C2C2E' : '#D8D8D8',
              overflow: 'hidden',
            },
          ]}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              {
                borderRadius: height / 2,
                backgroundColor: activeColor,
                opacity: bgOpacity,
              },
            ]}
          />
        </View>
        <Animated.View
          style={{
            position: 'absolute',
            left: 3,
            width: height - 6,
            height: height - 6,
            borderRadius: (height - 6) / 2,
            backgroundColor: '#FFFFFF',
            transform: [
              {
                translateX: dotScale.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, thumbTravel],
                }),
              },
            ],
          }}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  track: {
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
