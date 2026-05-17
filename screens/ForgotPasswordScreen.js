import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
  Dimensions,
  StatusBar,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/ThemeContext';
import { useAuth } from '../lib/AuthContext';
import { appTypography } from '../lib/darkThemeConfig';
import LoadingButton from '../components/LoadingButton';
import { GLOBAL_LOADING_LOGO } from '../lib/appLogo';

const { width, height } = Dimensions.get('window');

/** Matches LoginScreen: canvas, card, inputs, gold CTA */
const createForgotPasswordStyles = (colors) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.loginCanvas,
    },
    topStrip: {
      height: 34,
      width: '100%',
    },
    keyboardAvoidingView: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    mainLayer: {
      flex: 1,
    },
    scrollView: {
      flex: 1,
    },
    backButtonWrap: {
      position: 'absolute',
      top: height * 0.008,
      left: width * 0.04,
      zIndex: 10,
    },
    backButton: {
      padding: width * 0.02,
      borderRadius: width * 0.02,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: width * 0.06,
      paddingTop: height * 0.02,
      paddingBottom: height * 0.1,
    },
    centerBlock: {
      width: '100%',
      marginTop: -height * 0.04,
    },
    headerInner: {
      alignItems: 'center',
      marginBottom: height * 0.022,
    },
    iconWrap: {
      width: width * 0.2,
      height: width * 0.2,
      borderRadius: width * 0.1,
      backgroundColor: '#000000',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: height * 0.018,
    },
    brandMark: {
      width: width * 0.14,
      height: width * 0.14,
    },
    title: {
      fontSize: width * 0.065,
      fontFamily: appTypography.bold,
      color: colors.text,
      marginBottom: height * 0.008,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: width * 0.04,
      fontFamily: appTypography.regular,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: width * 0.055,
      paddingHorizontal: width * 0.02,
    },
    card: {
      backgroundColor: colors.elevatedSurface,
      borderRadius: width * 0.06,
      padding: width * 0.08,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 24,
      elevation: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
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
      marginBottom: height * 0.018,
    },
    inputContainerError: {
      borderColor: colors.error,
      backgroundColor: colors.dangerTintBackground,
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
    errorText: {
      fontSize: width * 0.035,
      fontFamily: appTypography.regular,
      marginBottom: height * 0.012,
      marginLeft: width * 0.01,
    },
    errorContainer: {
      padding: width * 0.03,
      borderRadius: width * 0.03,
      marginBottom: height * 0.018,
      borderWidth: 1,
      borderColor: colors.error + '55',
    },
    actionButton: {
      backgroundColor: '#D4A017',
      borderRadius: width * 0.0375,
      paddingVertical: height * 0.02,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: height * 0.006,
      marginBottom: height * 0.02,
    },
    actionButtonDisabled: {
      opacity: 0.65,
    },
    actionButtonText: {
      fontSize: width * 0.04,
      fontFamily: appTypography.medium,
      color: '#FFFFFF',
    },
    backToLogin: {
      alignItems: 'center',
      paddingVertical: height * 0.012,
    },
    backToLoginText: {
      fontSize: width * 0.04,
      fontFamily: appTypography.medium,
      color: '#D4A017',
    },
  });

const ForgotPasswordScreen = ({ navigation, route }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createForgotPasswordStyles(colors), [colors]);
  const { resetPassword, verifyResetPassword, loading } = useAuth();

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(route.params?.email || '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const codeInputRef = useRef(null);
  const newPasswordInputRef = useRef(null);
  const confirmPasswordInputRef = useRef(null);

  const handleSendCode = async () => {
    if (submitting) return;
    setErrors({});
    if (!email.trim()) {
      setErrors({ email: 'Please enter your email address' });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setErrors({ email: 'Please enter a valid email address' });
      return;
    }

    try {
      setSubmitting(true);
      const result = await resetPassword(email.trim());
      if (result.success) {
        Alert.alert('Code Sent', 'Check your email for the reset code.');
        setStep(2);
      } else {
        setErrors({ general: result.error || 'Failed to send reset code.' });
      }
    } catch (e) {
      console.error('Password reset error:', e);
      setErrors({ general: 'An unexpected error occurred. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyAndReset = async () => {
    if (submitting) return;
    setErrors({});
    if (!code.trim()) {
      setErrors({ code: 'Please enter the verification code' });
      return;
    }
    if (!newPassword.trim() || !confirmPassword.trim()) {
      setErrors({ general: 'Please enter and confirm your new password' });
      return;
    }
    if (newPassword.length < 8) {
      setErrors({ general: 'Password must be at least 8 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrors({ general: 'Passwords do not match' });
      return;
    }

    try {
      setSubmitting(true);
      const result = await verifyResetPassword(email.trim(), code.trim(), newPassword);
      if (result.success) {
        Alert.alert(
          'Password Updated',
          'Your password has been changed successfully.',
          [{ text: 'OK', onPress: () => navigation.navigate('Login') }]
        );
      } else {
        setErrors({ general: result.error || 'Failed to reset password.' });
      }
    } catch (e) {
      console.error('Verify code exception:', e);
      setErrors({ general: 'An unexpected error occurred. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.topStrip, { backgroundColor: colors.brandYellow }]} />
      <StatusBar
        barStyle="dark-content"
        backgroundColor={colors.brandYellow}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <View style={styles.mainLayer}>
          <View style={styles.backButtonWrap}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => (step === 2 ? setStep(1) : navigation.goBack())}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.scrollView}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.centerBlock}>
              <View style={styles.headerInner}>
                <View style={styles.iconWrap}>
                  <Image source={GLOBAL_LOADING_LOGO} style={styles.brandMark} resizeMode="contain" />
                </View>
                <Text style={styles.title}>Reset Password</Text>
                <Text style={styles.subtitle}>
                  {step === 1
                    ? 'Enter your email to receive a reset code.'
                    : 'Enter the code and your new password.'}
                </Text>
              </View>

              <View style={styles.card}>
            {step === 1 ? (
              <>
                <View
                  style={[
                    styles.inputContainer,
                    errors.email && styles.inputContainerError,
                  ]}
                >
                  <Ionicons
                    name="mail-outline"
                    size={20}
                    color={colors.textTertiary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Email address"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={handleSendCode}
                    editable={!(loading || submitting)}
                  />
                </View>
                {errors.email ? (
                  <Text style={[styles.errorText, { color: colors.error }]}>{errors.email}</Text>
                ) : null}
              </>
            ) : (
              <>
                <View
                  style={[
                    styles.inputContainer,
                    errors.code && styles.inputContainerError,
                  ]}
                >
                  <Ionicons
                    name="keypad-outline"
                    size={20}
                    color={colors.textTertiary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    ref={codeInputRef}
                    style={styles.input}
                    placeholder="Verification code"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => newPasswordInputRef.current?.focus()}
                    editable={!(loading || submitting)}
                  />
                </View>
                {errors.code ? (
                  <Text style={[styles.errorText, { color: colors.error }]}>{errors.code}</Text>
                ) : null}

                <View style={styles.inputContainer}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={colors.textTertiary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    ref={newPasswordInputRef}
                    style={styles.input}
                    placeholder="New password"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!newPasswordVisible}
                    autoCapitalize="none"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
                    editable={!(loading || submitting)}
                  />
                  <TouchableOpacity
                    onPress={() => setNewPasswordVisible((v) => !v)}
                    style={styles.passwordToggle}
                    disabled={loading || submitting}
                  >
                    <Ionicons
                      name={newPasswordVisible ? 'eye' : 'eye-off'}
                      size={20}
                      color="#9CA3AF"
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.inputContainer}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={colors.textTertiary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    ref={confirmPasswordInputRef}
                    style={styles.input}
                    placeholder="Confirm new password"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!confirmPasswordVisible}
                    autoCapitalize="none"
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={handleVerifyAndReset}
                    editable={!(loading || submitting)}
                  />
                  <TouchableOpacity
                    onPress={() => setConfirmPasswordVisible((v) => !v)}
                    style={styles.passwordToggle}
                    disabled={loading || submitting}
                  >
                    <Ionicons
                      name={confirmPasswordVisible ? 'eye' : 'eye-off'}
                      size={20}
                      color="#9CA3AF"
                    />
                  </TouchableOpacity>
                </View>
              </>
            )}

            {errors.general ? (
              <View style={[styles.errorContainer, { backgroundColor: colors.dangerTintBackground }]}>
                <Text style={[styles.errorText, { color: colors.error, marginBottom: 0 }]}>
                  {errors.general}
                </Text>
              </View>
            ) : null}

            {step === 1 ? (
              <LoadingButton
                style={[styles.actionButton, { backgroundColor: '#D4A017' }]}
                textStyle={styles.actionButtonText}
                title="Send Reset Code"
                loadingTitle="Sending code..."
                loading={loading || submitting}
                onPress={handleSendCode}
                indicatorColor="#FFFFFF"
              />
            ) : (
              <LoadingButton
                style={[styles.actionButton, { backgroundColor: '#D4A017' }]}
                textStyle={styles.actionButtonText}
                title="Reset Password"
                loadingTitle="Updating password..."
                loading={loading || submitting}
                onPress={handleVerifyAndReset}
                indicatorColor="#FFFFFF"
              />
            )}

            <TouchableOpacity style={styles.backToLogin} onPress={() => navigation.navigate('Login')}>
              <Text style={styles.backToLoginText}>Back to Sign In</Text>
            </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default ForgotPasswordScreen;
