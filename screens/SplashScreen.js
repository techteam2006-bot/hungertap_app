import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  StatusBar,
  Image,
} from 'react-native';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';
import { SPLASH_SCREEN_LOGO } from '../lib/appLogo';
import { setSplashShown } from '../lib/settingsCache';
const { width, height } = Dimensions.get('window');

const SplashScreen = ({ navigation }) => {
  const { colors, isDarkMode } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.5)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const textFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Mark splash as shown (settings cache / AsyncStorage)
    setSplashShown(true).catch(() => {});

    // Opening animation sequence
    Animated.sequence([
      // Logo appears first with scale and fade
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 40,
          friction: 6,
          useNativeDriver: true,
        }),
      ]),
      // Then text fades in
      Animated.timing(textFade, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    // Navigate to Login after 2.5 seconds
    const timer = setTimeout(() => {
      // Closing animation before navigation
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 0.8,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(textFade, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Navigate after closing animation completes
        navigation.replace('Login');
      });
    }, 2500);

    return () => {
      clearTimeout(timer);
    };
  }, [navigation]);

  const bg = colors.splashBackground;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={bg}
      />

      <View style={[styles.content, { backgroundColor: bg }]}>
        {/* Logo Image with animation */}
        <Animated.View
          style={[
            styles.logoContainer,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          <Image
            source={SPLASH_SCREEN_LOGO}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Tagline at bottom with animation */}
        <Animated.Text
          style={[
            styles.tagline,
            { color: colors.textTertiary },
            {
              opacity: textFade,
            },
          ]}
        >
          Delicious Food, Just a Tap Away
        </Animated.Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  logoContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  logoImage: {
    width: 220,
    height: 220,
    backgroundColor: '#000000',
    borderRadius: 48,
  },
  tagline: {
    fontSize: 15,
    fontFamily: appTypography.regular,
    marginBottom: 50,
    fontWeight: '300',
    letterSpacing: 0.5,
    textAlign: 'center',
    position: 'absolute',
    bottom: 10,
  },
});

export default SplashScreen;

