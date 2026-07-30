import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../lib/AuthContext';
import { useTheme } from '../lib/ThemeContext';
import AppIcon from '../components/AppIcon';
import LoadingButton from '../components/LoadingButton';
import SignupForm from '../components/SignupForm';
import { LOGIN_SCREEN_LOGO } from '../lib/appLogo';
import { appTypography } from '../lib/darkThemeConfig';

const { width, height } = Dimensions.get('window');
const BRAND_GOLD = '#D4A017';

const createLoginStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
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
      width: width * 0.5,
      height: width * 0.5,
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
      color: BRAND_GOLD,
      textAlign: 'center',
      marginBottom: height * 0.04,
      lineHeight: 22,
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
      backgroundColor: BRAND_GOLD,
      borderColor: BRAND_GOLD,
    },
    forgotPasswordLink: {
      alignSelf: 'center',
      marginBottom: height * 0.015,
    },
    forgotPasswordText: {
      fontSize: width * 0.035,
      fontFamily: appTypography.medium,
      color: BRAND_GOLD,
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
    helpText: {
      fontSize: width * 0.035,
      fontFamily: appTypography.medium,
      color: BRAND_GOLD,
    },
    actionButton: {
      backgroundColor: BRAND_GOLD,
      borderRadius: width * 0.0375,
      paddingVertical: height * 0.02,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: height * 0.01,
      marginBottom: height * 0.01,
    },
    actionButtonText: {
      fontSize: width * 0.04,
      fontFamily: appTypography.medium,
      color: '#FFFFFF',
    },
    switchModeSection: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: height * 0.02,
      flexWrap: 'wrap',
    },
    switchModeText: {
      fontSize: width * 0.035,
      fontFamily: appTypography.regular,
      color: colors.textSecondary,
    },
    switchModeLink: {
      fontSize: width * 0.035,
      fontFamily: appTypography.medium,
      color: BRAND_GOLD,
    },
  });

export default function LoginScreen({ navigation }) {
  const { signIn, authError, pendingSignupCompletion } = useAuth();
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createLoginStyles(colors), [colors]);

  const [email, setEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginPasswordVisible, setLoginPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(!pendingSignupCompletion);
  const [rememberMe, setRememberMe] = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;
  const loginScale = useRef(new Animated.Value(1)).current;
  const loginOpacity = useRef(new Animated.Value(1)).current;
  const signupScale = useRef(new Animated.Value(1)).current;
  const signupOpacity = useRef(new Animated.Value(0.6)).current;

  const scrollRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  const switchToLogin = useCallback((creds) => {
    setIsLoginMode(true);
    if (creds && typeof creds === 'object') {
      if (creds.email) setEmail(String(creds.email).trim());
      if (creds.password != null) setLoginPassword(String(creds.password));
    }
  }, []);

  useEffect(() => {
    if (pendingSignupCompletion) {
      setIsLoginMode(false);
    }
  }, [pendingSignupCompletion]);

  useEffect(() => {
    if (authError && authError.includes('Access denied')) {
      Alert.alert(
        'Access Denied',
        'This app is only for students. Admin accounts cannot access the student app.',
        [{ text: 'OK' }]
      );
    }
  }, [authError]);

  useEffect(() => {
    AsyncStorage.removeItem('savedEmails').catch(() => {});
  }, []);

  useEffect(() => {
    const loadRememberedEmail = async () => {
      try {
        const savedEmail = await AsyncStorage.getItem('rememberedEmail');
        if (savedEmail) {
          setEmail(savedEmail);
          setRememberMe(true);
        }
      } catch (_) {}
    };
    loadRememberedEmail();
  }, []);

  useEffect(() => {
    const targetValue = isLoginMode ? 0 : 1;
    Animated.spring(slideAnim, {
      toValue: targetValue,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();

    if (isLoginMode) {
      Animated.parallel([
        Animated.spring(loginScale, { toValue: 1.05, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.timing(loginOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(signupScale, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.timing(signupOpacity, { toValue: 0.6, duration: 300, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(signupScale, { toValue: 1.05, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.timing(signupOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(loginScale, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
        Animated.timing(loginOpacity, { toValue: 0.6, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [isLoginMode, slideAnim, loginScale, loginOpacity, signupScale, signupOpacity]);

  const handleLogin = async () => {
    if (!email.trim() || !loginPassword.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (loading) return;

    setLoading(true);
    try {
      if (__DEV__) console.log('Login attempt started');
      const { error } = await signIn(email.trim().toLowerCase(), loginPassword);

      if (error) {
        if (__DEV__) console.warn('Login failed:', error?.message || error);
        const msg = (error.message || '').toLowerCase();

        if (msg.includes('access denied') || msg.includes('only for students')) {
          Alert.alert(
            'Access Denied',
            'This app is only for students. Admin accounts cannot sign in here.',
            [{ text: 'OK' }]
          );
          return;
        }

        let errorMessage = 'Something went wrong. Please try again.';
        if (error.accountExists || error.code === 'incomplete_signup_or_wrong_password') {
          errorMessage =
            'This email is registered, but that password does not work. If you verified your email during Sign Up but did not finish, use Forgot password to set your password — then try again.';
        } else if (
          msg.includes('invalid') ||
          msg.includes('identifier') ||
          msg.includes('password') ||
          msg.includes('credentials')
        ) {
          errorMessage = 'Invalid email or password. Please try again.';
        } else if (msg.includes('locked') || msg.includes('too many')) {
          errorMessage = 'Too many login attempts. Please wait a moment and try again.';
        } else if (msg.includes('not found') || msg.includes('no user')) {
          errorMessage = 'No account found with this email. Please sign up first.';
        } else if (msg.includes('email') && msg.includes('confirm')) {
          errorMessage =
            'Please verify your email address before signing in. Check your inbox for a confirmation code.';
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
        if (__DEV__) console.log('Login successful');
      }
    } catch (error) {
      if (__DEV__) console.error('Login exception:', error?.message || error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar
        translucent
        backgroundColor="transparent"
        style={isDarkMode ? 'light' : 'dark'}
      />
      <View style={{ height: insets.top, backgroundColor: BRAND_GOLD, width: '100%' }} />
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
            <View style={styles.logoSection}>
              <View style={styles.logoContainer}>
                <Image source={LOGIN_SCREEN_LOGO} style={styles.logo} resizeMode="contain" />
              </View>
            </View>

            <View style={styles.toggleContainer}>
              <View style={styles.toggleBackground}>
                <Animated.View
                  style={[
                    styles.slidingIndicator,
                    {
                      transform: [
                        {
                          translateX: slideAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, (width * 0.6 - width * 0.03) / 2],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <View style={styles.gradientIndicator} />
                </Animated.View>

                <TouchableOpacity
                  style={styles.toggleOption}
                  onPress={() => setIsLoginMode(true)}
                  activeOpacity={0.8}
                  disabled={loading}
                >
                  <Animated.View style={{ transform: [{ scale: loginScale }], opacity: loginOpacity }}>
                    <Text style={[styles.toggleText, isLoginMode && styles.toggleTextActive]}>
                      Log in
                    </Text>
                  </Animated.View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.toggleOption}
                  onPress={() => setIsLoginMode(false)}
                  activeOpacity={0.8}
                  disabled={loading}
                >
                  <Animated.View
                    style={{ transform: [{ scale: signupScale }], opacity: signupOpacity }}
                  >
                    <Text style={[styles.toggleText, !isLoginMode && styles.toggleTextActive]}>
                      Sign Up
                    </Text>
                  </Animated.View>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.contentCard}>
              {isLoginMode ? (
                <>
                  <Text style={styles.welcomeText}>Login and satisfy Your Cravings !</Text>

                  <View style={styles.formSection}>
                    <View style={styles.inputContainer}>
                      <AppIcon
                        name="mail-outline"
                        size={20}
                        color="#9CA3AF"
                        style={styles.inputIcon}
                      />
                      <TextInput
                        ref={emailRef}
                        style={styles.input}
                        placeholder="Email"
                        placeholderTextColor="#9CA3AF"
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="email"
                        textContentType="username"
                        importantForAutofill="auto"
                        editable={!loading}
                        returnKeyType="next"
                        blurOnSubmit={false}
                        onSubmitEditing={() => passwordRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputContainer}>
                      <AppIcon
                        name="lock-closed-outline"
                        size={20}
                        color="#9CA3AF"
                        style={styles.inputIcon}
                      />
                      <TextInput
                        ref={passwordRef}
                        style={styles.input}
                        placeholder="Password"
                        placeholderTextColor="#9CA3AF"
                        value={loginPassword}
                        onChangeText={setLoginPassword}
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
                          name={loginPasswordVisible ? 'eye' : 'eye-off'}
                          size={20}
                          color="#9CA3AF"
                        />
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      onPress={() => navigation.navigate('ForgotPassword')}
                      style={styles.forgotPasswordLink}
                    >
                      <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                    </TouchableOpacity>

                    <LoadingButton
                      style={styles.actionButton}
                      textStyle={styles.actionButtonText}
                      title="Log in"
                      loadingTitle="Signing in..."
                      loading={loading}
                      onPress={handleLogin}
                      indicatorColor="#FFFFFF"
                    />

                    <View style={styles.loginOptionsRow}>
                      <TouchableOpacity
                        style={styles.rememberMeContainer}
                        onPress={() => setRememberMe(!rememberMe)}
                        activeOpacity={0.8}
                        disabled={loading}
                      >
                        <View
                          style={[
                            styles.termsCheckbox,
                            rememberMe && styles.termsCheckboxChecked,
                          ]}
                        >
                          {rememberMe ? (
                            <AppIcon name="checkmark" size={16} color="#ffffff" />
                          ) : null}
                        </View>
                        <Text style={styles.rememberMeText}>Remember me</Text>
                      </TouchableOpacity>

                      <TouchableOpacity onPress={() => navigation.navigate('AuthHelp')}>
                        <Text style={styles.helpText}>Help Me ?</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.switchModeSection}>
                    <Text style={styles.switchModeText}>Don't have an account? </Text>
                    <TouchableOpacity onPress={() => setIsLoginMode(false)} disabled={loading}>
                      <Text style={styles.switchModeLink}>Sign up here</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <SignupForm
                  navigation={navigation}
                  onSwitchToLogin={switchToLogin}
                />
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
