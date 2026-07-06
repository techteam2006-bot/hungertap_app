
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  Dimensions,
  Animated,
} from 'react-native';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';

import { useAuth } from '../lib/AuthContext';
import { useTheme } from '../lib/ThemeContext';
import AppIcon from '../components/AppIcon';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pxToPercentX, pxToPercentY } from '../utils/percent';
import { supabase } from '../lib/supabase';
import { appTypography } from '../lib/darkThemeConfig';
import NetworkErrorHandler from '../lib/NetworkErrorHandler';
import { LOGIN_SCREEN_LOGO } from '../lib/appLogo';
import { describeSignUpFailure, isEmailAlreadyInUseError } from '../lib/authErrorMessages';
import LoadingButton from '../components/LoadingButton';

const { width, height } = Dimensions.get('window');

/** If the user pastes a canteen row UUID, resolve by `id`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve canteen during sign-up: full id, then case-insensitive substring on `name`.
 * The old `.ilike('name', input)` without `%` required the whole DB `name` to equal the input,
 * so short tokens like "iare1" failed when the stored name was longer (e.g. "IARE Block 1").
 */
async function lookupCanteenForSignup(raw) {
  try {
    // ✅ error handled
    const trimmed = String(raw || '').trim();
    if (!trimmed) {
      return { ok: false, reason: 'empty' };
    }

    if (UUID_RE.test(trimmed)) {
      const { data, error } = await supabase
        .from('canteens')
        .select('id, college_id, is_open, name')
        .eq('id', trimmed)
        .maybeSingle();
      if (error) {
        console.error('lookupCanteenForSignup:', error.message || error);
        return { ok: false, reason: 'fetch', error };
      }
      if (data) return { ok: true, row: data };
    }

    const safeForLike = trimmed.replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!safeForLike) {
      return { ok: false, reason: 'empty' };
    }

    const { data: rows, error } = await supabase
      .from('canteens')
      .select('id, college_id, is_open, name')
      .ilike('name', `%${safeForLike}%`)
      .limit(30);

    if (error) {
      console.error('lookupCanteenForSignup:', error.message || error);
      return { ok: false, reason: 'fetch', error };
    }

    if (!rows?.length) {
      return { ok: false, reason: 'not_found' };
    }

    const lower = trimmed.toLowerCase();
    const exact = rows.find((r) => (r.name || '').trim().toLowerCase() === lower);
    if (exact) return { ok: true, row: exact };

    if (rows.length === 1) {
      return { ok: true, row: rows[0] };
    }

    const prefixOnly = rows.filter((r) => (r.name || '').toLowerCase().startsWith(lower));
    if (prefixOnly.length === 1) {
      return { ok: true, row: prefixOnly[0] };
    }

    return { ok: false, reason: 'ambiguous', rows };
  } catch (err) {
    console.error('Unexpected Error:', err);
    return { ok: false, reason: 'fetch', error: err };
  }
}

const createLoginStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    safeAreaTop: {
      flex: 0,
      backgroundColor: '#D4A017',
    },
    safeArea: {
      flex: 1,
      backgroundColor: colors.loginCanvas,
    },
    keyboardAvoidingView: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: width * 0.06,
      paddingTop: height * 0.025,
      paddingBottom: height * 0.05,
      backgroundColor: 'transparent',
    },
    logoSection: {
      alignItems: 'center',
      marginTop: height * 0.01875,
      marginBottom: height * 0.000625,
    },
    logoContainer: {
      marginBottom: height * 0.000625,
    },
    logo: {
      width: width * 0.50,
      height: width * 0.50,
      borderRadius: width * 0.06,
    },
    toggleContainer: {
      marginTop: height * 0.0125,
      marginBottom: height * 0.025,
    },
    toggleBackground: {
      flexDirection: 'row',
      backgroundColor: colors.mutedRowBackground,
      borderRadius: width * 0.04,
      padding: width * 0.015,
      width: width * 0.6,
      alignSelf: 'center',
      position: 'relative',
      overflow: 'hidden',
    },
    slidingIndicator: {
      position: 'absolute',
      top: width * 0.015,
      left: width * 0.015,
      width: (width * 0.6 - width * 0.03) / 2,
      bottom: width * 0.015,
      borderRadius: width * 0.03,
      zIndex: 0,
    },
    gradientIndicator: {
      flex: 1,
      borderRadius: width * 0.03,
      backgroundColor: colors.elevatedSurface,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    toggleOption: {
      flex: 1,
      zIndex: 1,
      paddingVertical: height * 0.015,
      paddingHorizontal: width * 0.04,
      borderRadius: width * 0.03,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toggleOptionActive: {
      backgroundColor: colors.elevatedSurface,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    toggleText: {
      fontSize: width * 0.04,
      fontFamily: appTypography.regular,
      fontWeight: '500',
      color: colors.textTertiary,
    },
    toggleTextActive: {
      fontFamily: appTypography.medium,
      fontWeight: '500',
      color: colors.text,
    },
    contentCard: {
      backgroundColor: colors.elevatedSurface,
      borderRadius: width * 0.06,
      padding: width * 0.08,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 24,
      elevation: 8,
    },
    welcomeText: {
      fontSize: 16,
      fontFamily: appTypography.regular,
      fontWeight: '400',
      color: '#D4A017',
      textAlign: 'center',
      marginBottom: height * 0.04,
      lineHeight: 22,
    },
    welcomeTextSignup: {
      fontSize: width * 0.06,
      fontFamily: appTypography.medium,
      fontWeight: '500',
      lineHeight: width * 0.075,
      color: colors.text,
    },
    formSection: {
      width: '100%',
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.inputBackground,
      borderRadius: width * 0.03,
      paddingHorizontal: width * 0.04,
      height: height * 0.07,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: height * 0.02,
    },
    inputIcon: {
      marginRight: width * 0.03,
    },
    input: {
      flex: 1,
      fontSize: width * 0.04,
      fontFamily: appTypography.regular,
      color: colors.text,
      height: '100%',
      paddingVertical: 0,
      textAlignVertical: 'center',
    },
    passwordToggle: {
      padding: width * 0.01,
    },
    termsContainer: {
      marginTop: height * 0.01,
      marginBottom: height * 0.02,
      backgroundColor: 'transparent',
      padding: 0,
    },
    termsRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    termsCheckbox: {
      width: width * 0.05,
      height: width * 0.05,
      borderRadius: width * 0.01,
      borderWidth: 2,
      borderColor: colors.textSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: width * 0.03,
      backgroundColor: colors.elevatedSurface,
    },
    termsCheckboxChecked: {
      backgroundColor: '#D4A017',
      borderColor: '#D4A017',
    },
    termsText: {
      fontSize: width * 0.0375,
      fontFamily: appTypography.regular,
      color: colors.text,
      lineHeight: width * 0.055,
      fontWeight: '400',
    },
    termsLink: {
      color: '#D4A017',
      fontFamily: appTypography.semiBold,
      textDecorationLine: 'underline',
    },
    forgotPasswordLink: {
      alignSelf: 'center',
      marginBottom: height * 0.015,
    },
    loginOptionsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: height * 0.01,
      marginBottom: height * 0.02,
    },
    rememberMeContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    rememberMeText: {
      fontSize: width * 0.035,
      fontFamily: appTypography.regular,
      color: colors.textSecondary,
    },
    forgotPasswordText: {
      fontSize: width * 0.035,
      fontFamily: appTypography.medium,
      fontWeight: '500',
      color: colors.textSecondary,
    },
    actionButton: {
      backgroundColor: '#D4A017',
      borderRadius: width * 0.0375,
      paddingVertical: height * 0.02,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: height * 0.000625,
      marginBottom: height * 0.03125,
    },
    actionButtonText: {
      fontSize: width * 0.04,
      fontFamily: appTypography.medium,
      fontWeight: '500',
      color: '#FFFFFF',
      lineHeight: width * 0.055,
    },
    bottomRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: height * 0.04,
    },
    helpText: {
      fontSize: width * 0.04,
      fontFamily: appTypography.regular,
      fontWeight: '500',
      color: colors.textSecondary,
      lineHeight: width * 0.055,
    },
    resendLink: {
      marginTop: height * 0.01,
      alignSelf: 'center',
    },
    resendText: {
      fontSize: width * 0.035,
      fontFamily: appTypography.regular,
      fontWeight: '500',
      color: colors.textSecondary,
      lineHeight: width * 0.05,
    },
    switchModeSection: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
    },
    switchModeText: {
      fontSize: width * 0.0375,
      fontFamily: appTypography.regular,
      fontWeight: '500',
      color: colors.textTertiary,
      lineHeight: width * 0.055,
    },
    switchModeLink: {
      fontSize: width * 0.04,
      fontFamily: appTypography.regular,
      fontWeight: '500',
      color: '#D4A017',
      lineHeight: width * 0.055,
    },
  });

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [canteenName, setCanteenName] = useState('');
  const [loginPasswordVisible, setLoginPasswordVisible] = useState(false);
  const [signupPasswordVisible, setSignupPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true); // true for login, false for signup
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  // Supabase uses email confirmation links — no in-app code verification.
  const { signIn, signUp, authError, isSignedIn } = useAuth();
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createLoginStyles(colors), [colors]);

  // Show error if user was blocked due to non-student role
  useEffect(() => {
    if (authError && authError.includes('Access denied')) {
      Alert.alert(
        'Access Denied',
        'This app is only for students. Admin accounts cannot access the student app.',
        [{ text: 'OK' }]
      );
    }
  }, [authError]);

  // Animation values for smooth toggle
  const slideAnim = useRef(new Animated.Value(0)).current; // 0 for login, 1 for signup
  const loginScale = useRef(new Animated.Value(1)).current;
  const loginOpacity = useRef(new Animated.Value(1)).current;
  const signupScale = useRef(new Animated.Value(1)).current;
  const signupOpacity = useRef(new Animated.Value(0.6)).current;

  // Scroll handling refs
  const scrollRef = useRef(null);
  const inputRefs = useRef({
    fullName: null,
    canteenName: null,
    email: null,
    loginPassword: null,
    signupPassword: null,
    confirmPassword: null,
  }).current;
  const fieldPositions = useRef({}).current;

  const scrollToField = (key) => {
    try {
      const y = fieldPositions[key];
      if (y != null && scrollRef.current) {
        scrollRef.current.scrollTo({ y: Math.max(0, y - 80), animated: true });
      }
    } catch (_) { }
  };

  // Drop legacy stored email list (no longer used; privacy)
  useEffect(() => {
    AsyncStorage.removeItem('savedEmails').catch(() => { });
  }, []);

  // Load remembered email
  useEffect(() => {
    const loadRememberedEmail = async () => {
      try {
        const savedEmail = await AsyncStorage.getItem('rememberedEmail');
        if (savedEmail) {
          setEmail(savedEmail);
          setRememberMe(true);
        }
      } catch (e) {}
    };
    loadRememberedEmail();
  }, []);

  // Animate toggle when isLoginMode changes
  useEffect(() => {
    const targetValue = isLoginMode ? 0 : 1;

    // Spring animation for sliding indicator
    Animated.spring(slideAnim, {
      toValue: targetValue,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();

    // Scale and fade animations for text
    if (isLoginMode) {
      // Login active
      Animated.parallel([
        Animated.spring(loginScale, {
          toValue: 1.05,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(loginOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(signupScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(signupOpacity, {
          toValue: 0.6,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Signup active
      Animated.parallel([
        Animated.spring(signupScale, {
          toValue: 1.05,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(signupOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(loginScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(loginOpacity, {
          toValue: 0.6,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isLoginMode]);

  const handleLogin = async () => {
    if (!email.trim() || !loginPassword.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (loading) return;

    setLoading(true);
    try {
      if (__DEV__) {
        console.log('Login attempt started');
      }

      const { data, error } = await signIn(email.trim(), loginPassword);

      if (error) {
        if (__DEV__) {
          console.error('Login error:', error?.message || error);
        }

        const msg = (error.message || '').toLowerCase();

        if (msg.includes('access denied') || msg.includes('only for students')) {
          Alert.alert('Access Denied', 'This app is only for students. Admin accounts cannot sign in here.', [{ text: 'OK' }]);
          return;
        }

        let errorMessage = 'Something went wrong. Please try again.';
        if (msg.includes('invalid') || msg.includes('identifier') || msg.includes('password') || msg.includes('credentials')) {
          errorMessage = 'Invalid email or password. Please try again.';
        } else if (msg.includes('locked') || msg.includes('too many')) {
          errorMessage = 'Too many login attempts. Please wait a moment and try again.';
        } else if (msg.includes('not found') || msg.includes('no user')) {
          errorMessage = 'No account found with this email. Please sign up first.';
        } else if (msg.includes('email') && msg.includes('confirm')) {
          errorMessage = 'Please verify your email address before signing in. Check your inbox for a confirmation link.';
        } else if (msg.includes('network') || msg.includes('fetch')) {
          errorMessage = 'Connection error. Please check your internet and try again.';
        }

        Alert.alert('Login Failed', errorMessage);
      } else {
        if (rememberMe) {
          AsyncStorage.setItem('rememberedEmail', email.trim());
        } else {
          AsyncStorage.removeItem('rememberedEmail');
        }
        if (__DEV__) {
          console.log('Login successful');
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Login exception:', error?.message || error);
      }
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (isSignedIn) {
      Alert.alert('Already signed in', 'You already have an account and are currently logged in.');
      return;
    }

    if (!email.trim() || !signupPassword.trim() || !fullName.trim() || !canteenName.trim() || !confirmPassword.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (signupPassword.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters long');
      return;
    }

    if (signupPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    if (!acceptTerms) {
      Alert.alert('Error', 'Please accept the terms and conditions');
      return;
    }
    if (loading) return;

    setLoading(true);
    try {
      const canteenLookup = await lookupCanteenForSignup(canteenName);

      if (canteenLookup.reason === 'fetch' && canteenLookup.error) {
        if (__DEV__) {
          console.warn('Canteen lookup error:', canteenLookup.error?.message || canteenLookup.error);
        }
        Alert.alert(
          'Connection Error',
          'Could not verify your canteen. Please check your internet connection and try again.'
        );
        return;
      }

      if (!canteenLookup.ok) {
        if (canteenLookup.reason === 'ambiguous' && canteenLookup.rows?.length) {
          const hint = canteenLookup.rows
            .slice(0, 4)
            .map((r) => r.name)
            .filter(Boolean)
            .join(', ');
          Alert.alert(
            'Which canteen?',
            `More than one canteen matches "${canteenName.trim()}". Type the full official name as listed on campus. Examples: ${hint}`
          );
        } else {
          Alert.alert(
            'Invalid Canteen',
            'Canteen not found. Use the full canteen name, a short code that appears in its name, or paste the canteen ID from your admin.'
          );
        }
        return;
      }

      const canteenRow = canteenLookup.row;
      if (canteenRow.is_open === false) {
        Alert.alert('Canteen Closed', 'This canteen is closed. Please contact admin.');
        return;
      }

      // `canteen_id` / `college_id` must be strings in auth user_metadata for trigger `handle_new_auth_user`
      const { data, error, needsVerification } = await signUp(
        email.trim(),
        signupPassword,
        {
          full_name: fullName.trim(),
          canteen_id: String(canteenRow.id),
          college_id: canteenRow.college_id != null ? String(canteenRow.college_id) : undefined,
        }
      );

      if (error) {
        if (__DEV__) {
          console.error('Signup error:', error?.message || error);
        }
        const { title, message } = describeSignUpFailure(error);
        Alert.alert(title, message);
        if (isEmailAlreadyInUseError(error)) {
          setIsLoginMode(true);
        }
      } else if (needsVerification) {
        if (__DEV__) {
          console.log('Signup pending email verification');
        }
        Alert.alert(
          'Verify Your Email',
          'A confirmation link has been sent to your email address. Check your inbox (and spam/junk folder). Once you click the link, come back and sign in with your email and password.',
          [
            {
              text: 'OK',
              onPress: () => {
                setIsLoginMode(true);
                setSignupPassword('');
                setConfirmPassword('');
                setFullName('');
                setCanteenName('');
              },
            },
          ]
        );
      } else if (__DEV__) {
        console.log('Signup completed');
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Unexpected signup error:', error?.message || error);
      }
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };


  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" style="dark" />
      <View style={{ height: insets.top, backgroundColor: '#D4A017', width: '100%' }} />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoidingView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {/* Logo Section */}
            <View style={styles.logoSection}>
              <View style={styles.logoContainer}>
                <Image source={LOGIN_SCREEN_LOGO} style={styles.logo} resizeMode="contain" />
              </View>
            </View>


            {/* Toggle Container with smooth animation */}
            <View style={styles.toggleContainer}>
              <View style={styles.toggleBackground}>
                {/* Animated sliding gradient indicator */}
                <Animated.View
                  style={[
                    styles.slidingIndicator,
                    {
                      transform: [
                        {
                          translateX: slideAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, (width * 0.6 - width * 0.03) / 2], // Same as indicator width
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <View style={styles.gradientIndicator} />
                </Animated.View>

                {/* Login Option */}
                <TouchableOpacity
                  style={styles.toggleOption}
                  onPress={() => setIsLoginMode(true)}
                  activeOpacity={0.8}
                  disabled={loading}
                >
                  <Animated.View
                    style={{
                      transform: [{ scale: loginScale }],
                      opacity: loginOpacity,
                    }}
                  >
                    <Text style={[styles.toggleText, isLoginMode && styles.toggleTextActive]}>
                      Log in
                    </Text>
                  </Animated.View>
                </TouchableOpacity>

                {/* Signup Option */}
                <TouchableOpacity
                  style={styles.toggleOption}
                  onPress={() => setIsLoginMode(false)}
                  activeOpacity={0.8}
                  disabled={loading}
                >
                  <Animated.View
                    style={{
                      transform: [{ scale: signupScale }],
                      opacity: signupOpacity,
                    }}
                  >
                    <Text style={[styles.toggleText, !isLoginMode && styles.toggleTextActive]}>
                      Sign Up
                    </Text>
                  </Animated.View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Content Card */}
            <View style={styles.contentCard}>
              {/* Welcome Text */}
              <Text style={[
                styles.welcomeText,
                !isLoginMode && styles.welcomeTextSignup
              ]}>
                {isLoginMode ? 'Login and satisfy Your Cravings !' : 'Create an Account'}
              </Text>

              <View style={styles.formSection}>
                {/* Full Name Input - Only for Sign Up */}
                {!isLoginMode && (
                  <View style={styles.inputContainer} onLayout={(e) => { fieldPositions.fullName = e.nativeEvent.layout.y; }}>
                    <AppIcon name="person-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      ref={(r) => { inputRefs.fullName = r; }}
                      style={styles.input}
                      placeholder="Full Name"
                      placeholderTextColor="#9CA3AF"
                      value={fullName}
                      onChangeText={setFullName}
                      onFocus={() => scrollToField('fullName')}
                      autoCapitalize="words"
                      autoCorrect={false}
                      editable={!loading}
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => { inputRefs.canteenName && inputRefs.canteenName.focus(); }}
                    />
                  </View>
                )}

                {/* Canteen ID Input (Canteen Name) - Only for Sign Up */}
                {!isLoginMode && (
                  <View style={styles.inputContainer} onLayout={(e) => { fieldPositions.canteenName = e.nativeEvent.layout.y; }}>
                    <AppIcon name="business-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      ref={(r) => { inputRefs.canteenName = r; }}
                      style={styles.input}
                      placeholder="Canteen name"
                      placeholderTextColor="#9CA3AF"
                      value={canteenName}
                      onChangeText={setCanteenName}
                      onFocus={() => scrollToField('canteenName')}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      textContentType="none"
                      importantForAutofill="no"
                      editable={!loading}
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => { inputRefs.email && inputRefs.email.focus(); }}
                    />
                  </View>
                )}

                {/* Email Input */}
                <View style={styles.inputContainer} onLayout={(e) => { fieldPositions.email = e.nativeEvent.layout.y; }}>
                  <AppIcon name="mail-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                  <TextInput
                    ref={(r) => { inputRefs.email = r; }}
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor="#9CA3AF"
                    value={email}
                    onChangeText={setEmail}
                    onFocus={() => scrollToField('email')}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete={isLoginMode ? 'email' : 'off'}
                    textContentType={isLoginMode ? 'username' : 'none'}
                    importantForAutofill={isLoginMode ? 'auto' : 'no'}
                    editable={!loading}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => {
                      if (isLoginMode) {
                        inputRefs.loginPassword && inputRefs.loginPassword.focus();
                      } else {
                        inputRefs.signupPassword && inputRefs.signupPassword.focus();
                      }
                    }}
                  />
                </View>

                {/* Password — login only (separate state from signup) */}
                {isLoginMode && (
                  <View style={styles.inputContainer} onLayout={(e) => { fieldPositions.password = e.nativeEvent.layout.y; }}>
                    <AppIcon name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      ref={(r) => { inputRefs.loginPassword = r; }}
                      style={styles.input}
                      placeholder="Password"
                      placeholderTextColor="#9CA3AF"
                      value={loginPassword}
                      onChangeText={setLoginPassword}
                      onFocus={() => scrollToField('password')}
                      secureTextEntry={!loginPasswordVisible}
                      autoCapitalize="none"
                      autoComplete="password"
                      textContentType="password"
                      importantForAutofill="auto"
                      editable={!loading}
                      returnKeyType="done"
                      blurOnSubmit
                      onSubmitEditing={handleLogin}
                    />
                    <TouchableOpacity
                      onPress={() => setLoginPasswordVisible((v) => !v)}
                      style={styles.passwordToggle}
                      disabled={loading}
                    >
                      <AppIcon
                        name={loginPasswordVisible ? "eye" : "eye-off"}
                        size={20}
                        color="#9CA3AF"
                      />
                    </TouchableOpacity>
                  </View>
                )}

                {/* Password — signup only (separate from login) */}
                {!isLoginMode && (
                  <View style={styles.inputContainer} onLayout={(e) => { fieldPositions.password = e.nativeEvent.layout.y; }}>
                    <AppIcon name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      ref={(r) => { inputRefs.signupPassword = r; }}
                      style={styles.input}
                      placeholder="Password"
                      placeholderTextColor="#9CA3AF"
                      value={signupPassword}
                      onChangeText={setSignupPassword}
                      onFocus={() => scrollToField('password')}
                      secureTextEntry={!signupPasswordVisible}
                      autoCapitalize="none"
                      autoComplete="off"
                      textContentType="none"
                      importantForAutofill="no"
                      editable={!loading}
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => { inputRefs.confirmPassword && inputRefs.confirmPassword.focus(); }}
                    />
                    <TouchableOpacity
                      onPress={() => setSignupPasswordVisible((v) => !v)}
                      style={styles.passwordToggle}
                      disabled={loading}
                    >
                      <AppIcon
                        name={signupPasswordVisible ? "eye" : "eye-off"}
                        size={20}
                        color="#9CA3AF"
                      />
                    </TouchableOpacity>
                  </View>
                )}

                {/* Confirm Password Input - Only for Sign Up */}
                {!isLoginMode && (
                  <View style={styles.inputContainer} onLayout={(e) => { fieldPositions.confirmPassword = e.nativeEvent.layout.y; }}>
                    <AppIcon name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                    <TextInput
                      ref={(r) => { inputRefs.confirmPassword = r; }}
                      style={styles.input}
                      placeholder="Confirm Password"
                      placeholderTextColor="#9CA3AF"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      onFocus={() => scrollToField('confirmPassword')}
                      secureTextEntry={!confirmPasswordVisible}
                      autoCapitalize="none"
                      autoComplete="off"
                      textContentType="none"
                      importantForAutofill="no"
                      editable={!loading}
                      returnKeyType="done"
                      blurOnSubmit
                      onSubmitEditing={handleSignUp}
                    />
                    <TouchableOpacity
                      onPress={() => setConfirmPasswordVisible((v) => !v)}
                      style={styles.passwordToggle}
                      disabled={loading}
                    >
                      <AppIcon
                        name={confirmPasswordVisible ? "eye" : "eye-off"}
                        size={20}
                        color="#9CA3AF"
                      />
                    </TouchableOpacity>
                  </View>
                )}

                {/* Terms and Conditions - Only for Sign Up */}
                {!isLoginMode && (
                  <View style={styles.termsContainer}>
                    <View style={styles.termsRow}>
                      <TouchableOpacity
                        onPress={() => setAcceptTerms(!acceptTerms)}
                        activeOpacity={0.8}
                        disabled={loading}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      >
                        <View style={[styles.termsCheckbox, acceptTerms && styles.termsCheckboxChecked]}>
                          {acceptTerms && <AppIcon name="checkmark" size={16} color="#ffffff" />}
                        </View>
                      </TouchableOpacity>
                      <Text style={[styles.termsText, { flex: 1 }]}>
                        I read & accepted{' '}
                        <Text
                          style={styles.termsLink}
                          onPress={() => navigation.navigate('Legalities')}
                          suppressHighlighting
                        >
                          Terms of Service
                        </Text>
                      </Text>
                    </View>
                  </View>
                )}

                {/* Forgot Password - Centered below password */}
                {isLoginMode && (
                  <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgotPasswordLink}>
                    <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                  </TouchableOpacity>
                )}

                {/* Action Button */}
                <LoadingButton
                  style={styles.actionButton}
                  textStyle={styles.actionButtonText}
                  title={isLoginMode ? 'Log in' : 'Sign Up'}
                  loadingTitle={isLoginMode ? 'Signing in...' : 'Creating account...'}
                  loading={loading}
                  onPress={isLoginMode ? handleLogin : handleSignUp}
                  indicatorColor="#FFFFFF"
                />

                {/* Remember Me and Account Help */}
                {isLoginMode ? (
                  <View style={styles.loginOptionsRow}>
                    <TouchableOpacity 
                      style={styles.rememberMeContainer}
                      onPress={() => setRememberMe(!rememberMe)}
                      activeOpacity={0.8}
                      disabled={loading}
                    >
                      <View style={[styles.termsCheckbox, rememberMe && styles.termsCheckboxChecked]}>
                        {rememberMe && <AppIcon name="checkmark" size={16} color="#ffffff" />}
                      </View>
                      <Text style={styles.rememberMeText}>Remember me</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => navigation.navigate('AuthHelp')}>
                      <Text style={styles.helpText}>Help Me ?</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

              </View>

              {/* Switch Mode Link */}
              <View style={styles.switchModeSection}>
                <Text style={styles.switchModeText}>
                  {isLoginMode ? "Don't have an account? " : "Already have an account? "}
                </Text>
                <TouchableOpacity onPress={() => setIsLoginMode(!isLoginMode)} disabled={loading}>
                  <Text style={styles.switchModeLink}>
                    {isLoginMode ? 'Sign up here' : 'Log in here'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
