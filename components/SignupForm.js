import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import AppIcon from './AppIcon';
import LoadingButton from './LoadingButton';
import EmailVerificationSection from './EmailVerificationSection';
import PasswordRuleList, {
  passwordMeetsAllRules,
} from './PasswordRuleList';
import { useAuth } from '../lib/AuthContext';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';
import { describeOtpFailure, describeSignUpFailure, isEmailAlreadyInUseError } from '../lib/authErrorMessages';
import { lookupCanteenForSignup } from '../lib/canteenLookup';
import { openLegalPage } from '../lib/legalLinks';

const BRAND_GOLD = '#D4A017';
const EMAIL_RE = /^\S+@\S+\.\S+$/;

export default function SignupForm({ navigation, onSwitchToLogin, style }) {
  const { colors } = useTheme();
  const {
    sendSignupEmailOtp,
    verifyEmailCode,
    completeSignupAfterEmailOtp,
    clearPendingSignup,
    isSignedIn,
    pendingSignupCompletion,
  } = useAuth();

  // Name must stay a normal controlled field — never hydrate from pendingSignupMetadata /
  // AsyncStorage (that caused deleted text like "Xyzzz" to snap back).
  const [fullName, setFullName] = useState('');
  const [canteenName, setCanteenName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [generalSuccess, setGeneralSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState('');

  const passwordRef = useRef(null);
  const confirmRef = useRef(null);
  const passwordEnableAnim = useRef(new Animated.Value(0)).current;

  // Resume mid-OTP session only — never copy name/email from cached metadata into inputs.
  useEffect(() => {
    if (pendingSignupCompletion && isSignedIn) {
      setEmailVerified(true);
    }
  }, [pendingSignupCompletion, isSignedIn]);

  useEffect(() => {
    Animated.timing(passwordEnableAnim, {
      toValue: emailVerified ? 1 : 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (emailVerified) {
        setTimeout(() => passwordRef.current?.focus(), 120);
      }
    });
  }, [emailVerified, passwordEnableAnim]);

  // If OTP is revoked, unlock and clear post-OTP fields.
  useEffect(() => {
    if (!emailVerified) {
      setAcceptTerms(false);
      setPassword('');
      setConfirmPassword('');
      setPasswordError('');
      setConfirmError('');
    }
  }, [emailVerified]);

  const describeError = useCallback((error, context) => {
    return describeOtpFailure(error, { context }).message;
  }, []);

  const emailLooksValid = useMemo(() => EMAIL_RE.test(String(email || '').trim()), [email]);

  const passwordRulesOk = useMemo(() => passwordMeetsAllRules(password), [password]);
  const passwordsMatch = useMemo(
    () => !!password && !!confirmPassword && password === confirmPassword,
    [password, confirmPassword]
  );

  const postOtpUnlocked = emailVerified && !submitting;

  const canSubmit = useMemo(
    () =>
      !!fullName.trim() &&
      !!canteenName.trim() &&
      !!email.trim() &&
      emailVerified &&
      passwordRulesOk &&
      passwordsMatch &&
      acceptTerms &&
      !submitting,
    [
      fullName,
      canteenName,
      email,
      emailVerified,
      passwordRulesOk,
      passwordsMatch,
      acceptTerms,
      submitting,
    ]
  );

  const handleSendOtp = useCallback(
    async (addr) => {
      setGeneralError('');
      setGeneralSuccess('');
      if (!fullName.trim()) {
        setNameError('Please enter your full name before sending the code.');
        return { error: { message: 'Please enter your full name before sending the code.' } };
      }
      setNameError('');
      if (!canteenName.trim()) {
        return { error: { message: 'Please enter your canteen name before sending the code.' } };
      }
      const canteenLookup = await lookupCanteenForSignup(canteenName);
      if (canteenLookup.reason === 'fetch' && canteenLookup.error) {
        return { error: { message: 'Could not verify your canteen. Check your internet and try again.' } };
      }
      if (!canteenLookup.ok) {
        if (canteenLookup.reason === 'ambiguous' && canteenLookup.rows?.length) {
          const hint = canteenLookup.rows
            .slice(0, 4)
            .map((r) => r.name)
            .filter(Boolean)
            .join(', ');
          return {
            error: {
              message: `More than one canteen matches. Type the full official name. Examples: ${hint}`,
            },
          };
        }
        return {
          error: {
            message:
              'Canteen not found. Use the full canteen name or paste the canteen ID from your admin.',
          },
        };
      }
      if (canteenLookup.row?.is_open === false) {
        return { error: { message: 'This canteen is closed. Please contact admin.' } };
      }
      return sendSignupEmailOtp(addr, { full_name: fullName.trim() });
    },
    [sendSignupEmailOtp, fullName, canteenName]
  );

  const handleVerifyOtp = useCallback(
    async (addr, code) =>
      verifyEmailCode(addr, code, {
        deferProfile: true,
        metadata: { full_name: fullName.trim() },
      }),
    [verifyEmailCode, fullName]
  );

  const validatePasswordsInline = () => {
    let ok = true;
    if (!password) {
      setPasswordError('Please enter a password.');
      ok = false;
    } else if (!passwordRulesOk) {
      setPasswordError('Password is too weak. Meet all requirements below.');
      ok = false;
    } else {
      setPasswordError('');
    }
    if (!confirmPassword) {
      setConfirmError('Please confirm your password.');
      ok = false;
    } else if (!passwordsMatch) {
      setConfirmError("Passwords don't match.");
      ok = false;
    } else {
      setConfirmError('');
    }
    return ok;
  };

  const handleSignUp = async () => {
    if (!canSubmit) return;
    setGeneralError('');
    setGeneralSuccess('');
    if (!validatePasswordsInline()) return;

    setSubmitting(true);
    try {
      const canteenLookup = await lookupCanteenForSignup(canteenName);
      if (canteenLookup.reason === 'fetch' && canteenLookup.error) {
        setGeneralError('Could not verify your canteen. Check your internet and try again.');
        return;
      }
      if (!canteenLookup.ok) {
        if (canteenLookup.reason === 'ambiguous' && canteenLookup.rows?.length) {
          const hint = canteenLookup.rows
            .slice(0, 4)
            .map((r) => r.name)
            .filter(Boolean)
            .join(', ');
          setGeneralError(
            `More than one canteen matches. Type the full official name. Examples: ${hint}`
          );
        } else {
          setGeneralError(
            'Canteen not found. Use the full canteen name or paste the canteen ID from your admin.'
          );
        }
        return;
      }

      const canteenRow = canteenLookup.row;
      if (canteenRow.is_open === false) {
        setGeneralError('This canteen is closed. Please contact admin.');
        return;
      }

      const { error } = await completeSignupAfterEmailOtp(password, {
        full_name: fullName.trim(),
        canteen_id: String(canteenRow.id),
        college_id: canteenRow.college_id != null ? String(canteenRow.college_id) : undefined,
      });

      if (error) {
        const { message } = describeSignUpFailure(error);
        setGeneralError(message);
        if (isEmailAlreadyInUseError(error)) {
          onSwitchToLogin?.();
        }
        return;
      }

      setGeneralError('');
      setGeneralSuccess('Account created. Please sign in.');
      onSwitchToLogin?.({
        email: String(email || '').trim().toLowerCase(),
        password: String(password || ''),
      });
      Alert.alert('Account created', 'Your email and password are filled in. Tap Sign In to continue.');
    } catch (e) {
      console.warn('SignupForm handleSignUp:', e?.message || e);
      setGeneralError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const tertiary = colors.textTertiary || '#9CA3AF';
  const okGreen = '#16A34A';
  const passwordLocked = !emailVerified;
  const preOtpEditable = !submitting;

  const onNameChange = (t) => {
    setFullName(t);
    if (nameError) setNameError('');
  };

  const confirmHint =
    !confirmPassword
      ? null
      : passwordsMatch
        ? { ok: true, text: 'Passwords match' }
        : { ok: false, text: "Passwords don't match" };

  return (
    <View style={style}>
      <Text style={[styles.title, { color: colors.text }]}>Create an Account</Text>

      {generalError ? (
        <View
          style={[
            styles.bannerError,
            { borderColor: colors.error + '55', backgroundColor: colors.dangerTintBackground },
          ]}
          accessibilityLiveRegion="polite"
        >
          <Text style={{ color: colors.error, textAlign: 'center', fontSize: 13 }}>{generalError}</Text>
        </View>
      ) : null}

      {generalSuccess ? (
        <View style={styles.bannerSuccess} accessibilityLiveRegion="polite">
          <AppIcon name="checkmark-circle" size={16} color={okGreen} style={undefined} />
          <Text style={styles.bannerSuccessText}>{generalSuccess}</Text>
        </View>
      ) : null}

      {/* Pre-OTP: name, canteen, email + Send OTP */}
      <View
        style={[
          styles.inputRow,
          { backgroundColor: colors.inputBackground, borderColor: nameError ? colors.error : colors.border },
        ]}
      >
        <AppIcon name="person-outline" size={18} color={tertiary} style={styles.icon} />
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder="Full Name"
          placeholderTextColor={tertiary}
          value={fullName}
          onChangeText={onNameChange}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          editable={preOtpEditable}
          returnKeyType="next"
          accessibilityLabel="Full name"
        />
      </View>
      {nameError ? <Text style={[styles.fieldError, { color: colors.error }]}>{nameError}</Text> : null}

      <View
        style={[
          styles.inputRow,
          { backgroundColor: colors.inputBackground, borderColor: colors.border },
        ]}
      >
        <AppIcon name="business-outline" size={18} color={tertiary} style={styles.icon} />
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder="Canteen name"
          placeholderTextColor={tertiary}
          value={canteenName}
          onChangeText={setCanteenName}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          editable={preOtpEditable}
          returnKeyType="next"
          accessibilityLabel="Canteen name"
        />
      </View>

      <EmailVerificationSection
        email={email}
        onEmailChange={setEmail}
        colors={colors}
        onSendOtp={handleSendOtp}
        onVerifyOtp={handleVerifyOtp}
        describeError={describeError}
        sendEnabled={!!fullName.trim() && !!canteenName.trim() && emailLooksValid && !submitting}
        onVerifiedChange={(v) => {
          setEmailVerified(v);
          if (v) {
            setGeneralSuccess('Email verified. Set your password to finish.');
            setGeneralError('');
          } else {
            clearPendingSignup?.();
            setGeneralSuccess('');
          }
        }}
        onOtpSent={() => {
          setGeneralSuccess('Verification code sent');
          setGeneralError('');
        }}
        resendSeconds={60}
        disabled={submitting}
        style={{ marginBottom: 8 }}
      />

      {/* Post-OTP: password, confirm, terms — locked until verified */}
      <Animated.View
        style={{
          opacity: passwordEnableAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.45, 1],
          }),
          transform: [
            {
              translateY: passwordEnableAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        }}
        pointerEvents={passwordLocked ? 'none' : 'auto'}
        accessibilityState={{ disabled: passwordLocked }}
      >
        <View
          style={[
            styles.inputRow,
            { backgroundColor: colors.inputBackground, borderColor: colors.border },
            passwordError ? { borderColor: colors.error } : null,
          ]}
        >
          <AppIcon name="lock-closed-outline" size={18} color={tertiary} style={styles.icon} />
          <TextInput
            ref={passwordRef}
            style={[styles.input, { color: colors.text }]}
            placeholder="Password"
            placeholderTextColor={tertiary}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (passwordError) setPasswordError('');
            }}
            secureTextEntry={!passwordVisible}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            editable={postOtpUnlocked}
            returnKeyType="next"
            accessibilityLabel="Password"
            accessibilityState={{ disabled: passwordLocked }}
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <TouchableOpacity
            onPress={() => setPasswordVisible((v) => !v)}
            disabled={passwordLocked}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
          >
            <AppIcon
              name={passwordVisible ? 'eye' : 'eye-off'}
              size={18}
              color={tertiary}
              style={undefined}
            />
          </TouchableOpacity>
        </View>
        {passwordError ? (
          <Text style={[styles.fieldError, { color: colors.error }]}>{passwordError}</Text>
        ) : null}

        <PasswordRuleList
          password={password}
          mutedColor={tertiary}
          okColor={okGreen}
          dimmed={passwordLocked}
        />

        <View
          style={[
            styles.inputRow,
            { backgroundColor: colors.inputBackground, borderColor: colors.border },
            confirmError || (confirmHint && !confirmHint.ok) ? { borderColor: colors.error } : null,
            confirmHint?.ok ? { borderColor: okGreen } : null,
          ]}
        >
          <AppIcon name="lock-closed-outline" size={18} color={tertiary} style={styles.icon} />
          <TextInput
            ref={confirmRef}
            style={[styles.input, { color: colors.text }]}
            placeholder="Confirm Password"
            placeholderTextColor={tertiary}
            value={confirmPassword}
            onChangeText={(t) => {
              setConfirmPassword(t);
              if (confirmError) setConfirmError('');
            }}
            secureTextEntry={!confirmVisible}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            editable={postOtpUnlocked}
            returnKeyType="done"
            accessibilityLabel="Confirm password"
            accessibilityState={{ disabled: passwordLocked }}
            onSubmitEditing={() => {
              if (canSubmit) handleSignUp();
            }}
          />
          <TouchableOpacity
            onPress={() => setConfirmVisible((v) => !v)}
            disabled={passwordLocked}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={confirmVisible ? 'Hide confirm password' : 'Show confirm password'}
          >
            <AppIcon
              name={confirmVisible ? 'eye' : 'eye-off'}
              size={18}
              color={tertiary}
              style={undefined}
            />
          </TouchableOpacity>
        </View>
        {confirmError ? (
          <Text style={[styles.fieldError, { color: colors.error }]}>{confirmError}</Text>
        ) : confirmHint ? (
          <Text style={[styles.fieldHint, { color: confirmHint.ok ? okGreen : colors.error }]}>
            {confirmHint.text}
          </Text>
        ) : null}

        <View style={[styles.termsRow, passwordLocked && styles.dimmed]}>
          <TouchableOpacity
            onPress={() => {
              if (!postOtpUnlocked) return;
              setAcceptTerms((v) => !v);
            }}
            disabled={!postOtpUnlocked}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptTerms, disabled: passwordLocked }}
            accessibilityLabel="Accept terms of service"
          >
            <View
              style={[
                styles.checkbox,
                { borderColor: colors.textSecondary },
                acceptTerms && styles.checkboxOn,
              ]}
            >
              {acceptTerms ? (
                <AppIcon name="checkmark" size={14} color="#fff" style={undefined} />
              ) : null}
            </View>
          </TouchableOpacity>
          <Text style={[styles.termsText, { color: colors.text }]}>
            I read & accepted{' '}
            <Text
              style={styles.termsLink}
              onPress={() => openLegalPage(navigation, 'termsOfService')}
              accessibilityRole="link"
            >
              Terms of Service
            </Text>
          </Text>
        </View>
      </Animated.View>

      <LoadingButton
        style={[styles.submit, !canSubmit && styles.submitDisabled]}
        textStyle={styles.submitText}
        title="Sign Up"
        loadingTitle="Creating Account..."
        loading={submitting}
        isLoading={submitting}
        disabled={!canSubmit}
        onPress={handleSignUp}
        indicatorColor="#FFFFFF"
        accessibilityLabel="Sign up"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 22,
    fontFamily: appTypography.medium,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 18,
  },
  bannerError: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  bannerSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  bannerSuccessText: {
    color: '#16A34A',
    fontWeight: '600',
    fontSize: 13,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    minHeight: 52,
    marginBottom: 12,
  },
  icon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: appTypography.regular,
    paddingVertical: 10,
  },
  fieldError: {
    fontSize: 12,
    marginTop: -6,
    marginBottom: 10,
    marginLeft: 4,
  },
  fieldHint: {
    fontSize: 12,
    marginTop: -6,
    marginBottom: 10,
    marginLeft: 4,
    fontWeight: '600',
  },
  dimmed: {
    opacity: 0.45,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: BRAND_GOLD,
    borderColor: BRAND_GOLD,
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    fontFamily: appTypography.regular,
  },
  termsLink: {
    color: BRAND_GOLD,
    fontFamily: appTypography.semiBold,
    textDecorationLine: 'underline',
  },
  submit: {
    backgroundColor: BRAND_GOLD,
    borderRadius: 14,
    minHeight: 52,
  },
  submitDisabled: {
    opacity: 0.45,
  },
  submitText: {
    color: '#FFFFFF',
    fontFamily: appTypography.medium,
    fontSize: 16,
  },
});
