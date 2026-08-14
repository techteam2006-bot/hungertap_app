import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
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
  Dimensions,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';
import BrandYellowStrip from '../components/BrandYellowStrip';
import OTPInput from '../components/OTPInput';
import CountdownTimer from '../components/CountdownTimer';
import PasswordRuleList, { passwordMeetsAllRules } from '../components/PasswordRuleList';
import { useTheme } from '../lib/ThemeContext';
import { useAuth } from '../lib/AuthContext';
import { appTypography } from '../lib/darkThemeConfig';
import LoadingButton from '../components/LoadingButton';
import { LOGIN_SCREEN_LOGO } from '../lib/appLogo';

const { width, height } = Dimensions.get('window');
const OTP_LENGTH = 6;
const RESEND_SECONDS = 120;

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
      backgroundColor: 'transparent',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: height * 0.016,
    },
    brandMark: {
      width: width * 0.22,
      height: width * 0.22,
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
    fieldLabel: {
      fontSize: width * 0.04,
      fontFamily: appTypography.semiBold,
      color: colors.textSecondary,
      marginBottom: height * 0.01,
      letterSpacing: 0.2,
    },
    otpSection: {
      marginBottom: height * 0.016,
    },
    otpHint: {
      fontSize: width * 0.04,
      fontFamily: appTypography.regular,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: height * 0.016,
      lineHeight: width * 0.055,
    },
    otpEmailHighlight: {
      fontFamily: appTypography.semiBold,
      color: colors.text,
    },
    otpBoxesWrap: {
      marginBottom: height * 0.006,
    },
    resendRow: {
      alignItems: 'center',
      marginTop: height * 0.014,
      marginBottom: height * 0.006,
      minHeight: height * 0.028,
      justifyContent: 'center',
    },
    resendText: {
      fontSize: width * 0.04,
      fontFamily: appTypography.medium,
      color: colors.textTertiary,
    },
    resendReady: {
      fontSize: width * 0.04,
      fontFamily: appTypography.semiBold,
      color: '#D4A017',
    },
    verifiedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: height * 0.012,
      marginBottom: height * 0.006,
    },
    verifiedText: {
      fontSize: width * 0.04,
      fontFamily: appTypography.semiBold,
      color: '#16A34A',
    },
    verifyingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: height * 0.012,
      minHeight: height * 0.028,
    },
    verifyingText: {
      fontSize: width * 0.04,
      fontFamily: appTypography.medium,
      color: colors.textTertiary,
    },
    passwordSectionLabel: {
      fontSize: width * 0.04,
      fontFamily: appTypography.semiBold,
      color: colors.textSecondary,
      marginTop: height * 0.01,
      marginBottom: height * 0.012,
    },
    passwordRules: {
      marginTop: -height * 0.006,
      marginBottom: height * 0.014,
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
      paddingVertical: height * 0.018,
      marginTop: height * 0.006,
    },
    backToLoginText: {
      fontSize: width * 0.046,
      fontFamily: appTypography.semiBold,
      color: '#D4A017',
    },
  });

const ForgotPasswordScreen = ({ navigation, route }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createForgotPasswordStyles(colors), [colors]);
  const {
    resetPassword,
    verifyResetOtp,
    completePasswordReset,
    clearPendingPasswordReset,
    signOut,
    loading,
  } = useAuth();

  const changePassword = route.params?.changePassword === true;

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(route.params?.email || '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [resendRestartKey, setResendRestartKey] = useState(0);
  const [resendRunning, setResendRunning] = useState(false);
  const newPasswordInputRef = useRef(null);
  const confirmPasswordInputRef = useRef(null);
  const verifyingLock = useRef(false);
  const lastTriedCode = useRef('');

  const startResendTimer = () => {
    setResendRunning(true);
    setResendRestartKey((k) => k + 1);
  };

  const resetOtpState = () => {
    setCode('');
    setOtpVerified(false);
    setVerifyingOtp(false);
    lastTriedCode.current = '';
    verifyingLock.current = false;
    setNewPassword('');
    setConfirmPassword('');
  };

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
        resetOtpState();
        setStep(2);
        startResendTimer();
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

  const handleResendCode = async () => {
    if (submitting || loading || verifyingOtp || otpVerified) return;
    setErrors({});
    try {
      setSubmitting(true);
      const result = await resetPassword(email.trim());
      if (result.success) {
        resetOtpState();
        startResendTimer();
        Alert.alert('Code Sent', 'A new reset code was sent to your email.');
      } else {
        setErrors({ general: result.error || 'Failed to resend code.' });
      }
    } catch (e) {
      console.error('Resend reset code error:', e);
      setErrors({ general: 'An unexpected error occurred. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const runVerifyOtp = useCallback(
    async (otpCode) => {
      if (verifyingLock.current || otpVerified || submitting) return;
      if (String(otpCode || '').length !== OTP_LENGTH) return;
      if (lastTriedCode.current === otpCode) return;
      lastTriedCode.current = otpCode;
      verifyingLock.current = true;
      setVerifyingOtp(true);
      setErrors((prev) => {
        const { code: _c, general: _g, ...rest } = prev;
        return rest;
      });
      try {
        const result = await verifyResetOtp(email.trim(), otpCode);
        if (!result.success) {
          setErrors({ code: result.error || 'Invalid or expired code.' });
          return;
        }
        setOtpVerified(true);
        setResendRunning(false);
        setTimeout(() => newPasswordInputRef.current?.focus(), 120);
      } catch (e) {
        console.error('Auto verify reset OTP:', e);
        setErrors({ code: 'Could not verify the code. Please try again.' });
      } finally {
        setVerifyingOtp(false);
        verifyingLock.current = false;
      }
    },
    [otpVerified, submitting, verifyResetOtp, email]
  );

  useEffect(() => {
    if (step !== 2 || otpVerified || verifyingOtp) return;
    if (String(code || '').length !== OTP_LENGTH) return;
    const t = setTimeout(() => runVerifyOtp(code), 100);
    return () => clearTimeout(t);
  }, [code, step, otpVerified, verifyingOtp, runVerifyOtp]);

  const goBackFromStep2 = async () => {
    if (otpVerified) {
      clearPendingPasswordReset?.();
      try {
        await signOut?.();
      } catch (_) {}
    }
    resetOtpState();
    setErrors({});
    setStep(1);
  };

  const handleResetPassword = async () => {
    if (submitting || !otpVerified) return;
    setErrors({});
    if (!newPassword.trim() || !confirmPassword.trim()) {
      setErrors({ general: 'Please enter and confirm your new password' });
      return;
    }
    if (!passwordMeetsAllRules(newPassword)) {
      setErrors({
        general: 'Password must meet all requirements listed below the password field.',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrors({ general: 'Passwords do not match' });
      return;
    }

    try {
      setSubmitting(true);
      const result = await completePasswordReset(newPassword);
      if (result.success) {
        Alert.alert(
          'Password Updated',
          changePassword
            ? 'Your password has been changed. Please sign in again with your new password.'
            : 'Your password has been changed successfully. Please sign in.',
          [
            {
              text: 'OK',
              onPress: () => navigation.navigate('Login'),
            },
          ]
        );
      } else {
        setErrors({ general: result.error || 'Failed to reset password.' });
      }
    } catch (e) {
      console.error('Complete password reset exception:', e);
      setErrors({ general: 'An unexpected error occurred. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
      <BrandYellowStrip />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <View style={styles.mainLayer}>
          <View style={styles.backButtonWrap}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => (step === 2 ? goBackFromStep2() : navigation.goBack())}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <AppIcon name="arrow-back" size={24} color={colors.text} />
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
                  <Image source={LOGIN_SCREEN_LOGO} style={styles.brandMark} resizeMode="contain" />
                </View>
                <Text style={styles.title}>{changePassword ? 'Change Password' : 'Reset Password'}</Text>
                <Text style={styles.subtitle}>
                  {step === 1
                    ? changePassword
                      ? 'We will send a verification code to your email.'
                      : 'Enter your email to receive a reset code.'
                    : otpVerified
                      ? 'Code verified. Choose a new password.'
                      : 'Enter the 6-digit code sent to your email.'}
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
                  <AppIcon
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
                    editable={!(changePassword || loading || submitting)}
                  />
                </View>
                {errors.email ? (
                  <Text style={[styles.errorText, { color: colors.error }]}>{errors.email}</Text>
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.otpSection}>
                  <Text style={styles.fieldLabel}>Verification code</Text>
                  {!otpVerified ? (
                    <Text style={styles.otpHint}>
                      Sent to{' '}
                      <Text style={styles.otpEmailHighlight}>{email.trim()}</Text>
                    </Text>
                  ) : null}
                  <View style={styles.otpBoxesWrap}>
                    <OTPInput
                      value={code}
                      onChange={(next) => {
                        if (otpVerified || verifyingOtp) return;
                        setCode(next);
                        if (String(next || '').length < OTP_LENGTH) {
                          lastTriedCode.current = '';
                        }
                        if (errors.code) {
                          setErrors((prev) => {
                            const { code: _c, ...rest } = prev;
                            return rest;
                          });
                        }
                      }}
                      length={OTP_LENGTH}
                      disabled={loading || submitting || verifyingOtp || otpVerified}
                      error={!!errors.code}
                      autoFocus={!otpVerified}
                      accentColor="#D4A017"
                      borderColor={colors.border || '#E5E7EB'}
                      errorColor={colors.error}
                      backgroundColor={colors.inputBackground || '#F9FAFB'}
                      textColor={colors.text}
                    />
                  </View>
                  {errors.code ? (
                    <Text
                      style={[
                        styles.errorText,
                        { color: colors.error, textAlign: 'center', marginLeft: 0 },
                      ]}
                    >
                      {errors.code}
                    </Text>
                  ) : null}
                  {verifyingOtp ? (
                    <View style={styles.verifyingRow}>
                      <ActivityIndicator size="small" color="#D4A017" />
                      <Text style={styles.verifyingText}>Verifying code…</Text>
                    </View>
                  ) : otpVerified ? (
                    <View style={styles.verifiedRow} accessibilityLiveRegion="polite">
                      <AppIcon name="checkmark-circle" size={18} color="#16A34A" />
                      <Text style={styles.verifiedText}>Code verified</Text>
                    </View>
                  ) : (
                    <View style={styles.resendRow}>
                      <CountdownTimer
                        seconds={RESEND_SECONDS}
                        restartKey={resendRestartKey}
                        running={resendRunning}
                        readyLabel="Resend code"
                        countingLabel={(t) => `Resend code in ${t}`}
                        onPressReady={handleResendCode}
                        disabled={loading || submitting || verifyingOtp}
                        textStyle={styles.resendText}
                        readyTextStyle={styles.resendReady}
                      />
                    </View>
                  )}
                </View>

                {otpVerified ? (
                  <>
                    <Text style={styles.passwordSectionLabel}>New password</Text>
                    <View style={styles.inputContainer}>
                      <AppIcon
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
                        <AppIcon
                          name={newPasswordVisible ? 'eye' : 'eye-off'}
                          size={20}
                          color="#9CA3AF"
                        />
                      </TouchableOpacity>
                    </View>

                    <PasswordRuleList
                      password={newPassword}
                      mutedColor={colors.textTertiary || '#9CA3AF'}
                      okColor="#16A34A"
                      style={styles.passwordRules}
                    />

                    <View style={styles.inputContainer}>
                      <AppIcon
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
                        onSubmitEditing={handleResetPassword}
                        editable={!(loading || submitting)}
                      />
                      <TouchableOpacity
                        onPress={() => setConfirmPasswordVisible((v) => !v)}
                        style={styles.passwordToggle}
                        disabled={loading || submitting}
                      >
                        <AppIcon
                          name={confirmPasswordVisible ? 'eye' : 'eye-off'}
                          size={20}
                          color="#9CA3AF"
                        />
                      </TouchableOpacity>
                    </View>
                  </>
                ) : null}
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
                title={changePassword ? 'Send Verification Code' : 'Send Reset Code'}
                loadingTitle="Sending code..."
                loading={loading || submitting}
                onPress={handleSendCode}
                indicatorColor="#FFFFFF"
              />
            ) : otpVerified ? (
              <LoadingButton
                style={[styles.actionButton, { backgroundColor: '#D4A017' }]}
                textStyle={styles.actionButtonText}
                title="Reset Password"
                loadingTitle="Updating password..."
                loading={loading || submitting}
                onPress={handleResetPassword}
                indicatorColor="#FFFFFF"
              />
            ) : null}

            <TouchableOpacity
              style={styles.backToLogin}
              onPress={() => (changePassword ? navigation.goBack() : navigation.navigate('Login'))}
            >
              <Text style={styles.backToLoginText}>
                {changePassword ? 'Back to Profile' : 'Back to Sign In'}
              </Text>
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
