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
  findNodeHandle,
  UIManager,
} from 'react-native';
import AppIcon from './AppIcon';
import LoadingButton from './LoadingButton';
import EmailVerificationSection from './EmailVerificationSection';
import PasswordRuleList, { passwordMeetsAllRules } from './PasswordRuleList';
import { useAuth } from '../lib/AuthContext';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';
import {
  describeOtpFailure,
  describeSignUpFailure,
  isEmailAlreadyInUseError,
  EMAIL_ALREADY_EXISTS_MESSAGE,
} from '../lib/authErrorMessages';
import { lookupCanteenForSignup } from '../lib/canteenLookup';
import { openLegalPage } from '../lib/legalLinks';

const BRAND_GOLD = '#D4A017';
const EMAIL_RE = /^\S+@\S+\.\S+$/;

const canteenValidationError = (message) => ({
  error: { code: 'CANTEEN_VALIDATION', message },
});

export default function SignupForm({ navigation, onSwitchToLogin, style, scrollRef }) {
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
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [generalSuccess, setGeneralSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState('');
  const [canteenError, setCanteenError] = useState('');

  const nameRef = useRef(null);
  const canteenRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmRef = useRef(null);
  const passwordEnableAnim = useRef(new Animated.Value(0)).current;
  const didInitialNameFocus = useRef(false);
  const [otpAwaitingCode, setOtpAwaitingCode] = useState(false);
  const otpAwaitingCodeRef = useRef(false);

  useEffect(() => {
    otpAwaitingCodeRef.current = otpAwaitingCode;
  }, [otpAwaitingCode]);

  const scrollFocusedIntoView = useCallback(
    (inputRef) => {
      const scroll = scrollRef?.current;
      const input = inputRef?.current;
      if (!scroll || !input) return;

      const scrollNode = findNodeHandle(scroll);
      const inputNode = findNodeHandle(input);
      if (!scrollNode || !inputNode) return;

      // Delay so keyboard height / layout settle before measuring.
      setTimeout(() => {
        try {
          UIManager.measureLayout(
            inputNode,
            scrollNode,
            () => {},
            (_x, y) => {
              scroll.scrollTo({
                y: Math.max(0, y - 100),
                animated: true,
              });
            }
          );
        } catch (_) {
          // Fallback: keep current scroll position
        }
      }, 150);
    },
    [scrollRef]
  );

  // Resume mid-OTP session only — never copy name/email from cached metadata into inputs.
  useEffect(() => {
    if (pendingSignupCompletion && isSignedIn) {
      setEmailVerified(true);
    }
  }, [pendingSignupCompletion, isSignedIn]);

  // Signup opens with focus on User Name once — never steal focus after OTP is shown.
  useEffect(() => {
    if (didInitialNameFocus.current) return undefined;
    if (emailVerified || pendingSignupCompletion || otpAwaitingCode) return undefined;
    didInitialNameFocus.current = true;
    const t = setTimeout(() => {
      if (!otpAwaitingCodeRef.current) nameRef.current?.focus();
    }, 320);
    return () => clearTimeout(t);
  }, [emailVerified, pendingSignupCompletion, otpAwaitingCode]);

  useEffect(() => {
    Animated.timing(passwordEnableAnim, {
      toValue: emailVerified ? 1 : 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (emailVerified) {
        setOtpAwaitingCode(false);
        setTimeout(() => {
          passwordRef.current?.focus();
          scrollFocusedIntoView(passwordRef);
        }, 120);
      }
    });
  }, [emailVerified, passwordEnableAnim, scrollFocusedIntoView]);

  // If OTP is revoked, unlock and clear post-OTP fields.
  useEffect(() => {
    if (!emailVerified) {
      setAcceptTerms(false);
      setPassword('');
      setConfirmPassword('');
      setPasswordError('');
      setConfirmError('');
      setPasswordTouched(false);
    }
  }, [emailVerified]);

  const describeError = useCallback((error, context) => {
    if (isEmailAlreadyInUseError(error)) return EMAIL_ALREADY_EXISTS_MESSAGE;
    const raw = (error && error.message) || String(error || '');
    if (raw.toLowerCase().includes('canteen')) return raw;
    return describeOtpFailure(error, { context }).message;
  }, []);

  const emailLooksValid = useMemo(() => EMAIL_RE.test(String(email || '').trim()), [email]);

  const passwordRulesOk = useMemo(() => passwordMeetsAllRules(password), [password]);
  const passwordsMatch = useMemo(
    () => !!password && !!confirmPassword && password === confirmPassword,
    [password, confirmPassword]
  );

  const postOtpUnlocked = emailVerified && !submitting;
  const showPasswordMissing =
    passwordTouched && !password && emailVerified;

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
        const message = 'Please enter your canteen name before sending the code.';
        setCanteenError(message);
        return canteenValidationError(message);
      }
      const canteenLookup = await lookupCanteenForSignup(canteenName);
      if (canteenLookup.reason === 'fetch' && canteenLookup.error) {
        const message = 'Could not verify your canteen. Check your internet and try again.';
        setCanteenError(message);
        return canteenValidationError(message);
      }
      if (!canteenLookup.ok) {
        let message;
        if (canteenLookup.reason === 'ambiguous' && canteenLookup.rows?.length) {
          const hint = canteenLookup.rows
            .slice(0, 4)
            .map((r) => r.name)
            .filter(Boolean)
            .join(', ');
          message = `More than one canteen matches. Type the full official name. Examples: ${hint}`;
        } else {
          message =
            'Canteen not found. Use the full canteen name or paste the canteen ID from your admin.';
        }
        setCanteenError(message);
        return canteenValidationError(message);
      }
      if (canteenLookup.row?.is_open === false) {
        const message = 'This canteen is closed. Please contact admin.';
        setCanteenError(message);
        return canteenValidationError(message);
      }
      setCanteenError('');
      // Store canteen on auth metadata at OTP send so public.users can be created right after verify.
      return sendSignupEmailOtp(addr, {
        full_name: fullName.trim(),
        canteen_id: String(canteenLookup.row.id),
        college_id:
          canteenLookup.row.college_id != null ? String(canteenLookup.row.college_id) : undefined,
      });
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
    setPasswordTouched(true);
    if (!password) {
      setPasswordError('Password is missing');
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
        setCanteenError('Could not verify your canteen. Check your internet and try again.');
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
          const message = `More than one canteen matches. Type the full official name. Examples: ${hint}`;
          setCanteenError(message);
          setGeneralError(message);
        } else {
          const message =
            'Canteen not found. Use the full canteen name or paste the canteen ID from your admin.';
          setCanteenError(message);
          setGeneralError(message);
        }
        return;
      }

      const canteenRow = canteenLookup.row;
      if (canteenRow.is_open === false) {
        const message = 'This canteen is closed. Please contact admin.';
        setCanteenError(message);
        setGeneralError(message);
        return;
      }
      setCanteenError('');

      const { error } = await completeSignupAfterEmailOtp(password, {
        full_name: fullName.trim(),
        canteen_id: String(canteenRow.id),
        college_id: canteenRow.college_id != null ? String(canteenRow.college_id) : undefined,
      });

      if (error) {
        if (isEmailAlreadyInUseError(error)) {
          setGeneralError(EMAIL_ALREADY_EXISTS_MESSAGE);
          return;
        }
        const { message } = describeSignUpFailure(error);
        setGeneralError(message);
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
          ref={nameRef}
          style={[styles.input, { color: colors.text }]}
          placeholder="User Name"
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
          blurOnSubmit={false}
          onFocus={() => scrollFocusedIntoView(nameRef)}
          onSubmitEditing={() => canteenRef.current?.focus()}
          accessibilityLabel="User name"
        />
      </View>
      {nameError ? <Text style={[styles.fieldError, { color: colors.error }]}>{nameError}</Text> : null}

      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.inputBackground,
            borderColor: canteenError ? colors.error : colors.border,
          },
        ]}
      >
        <AppIcon name="business-outline" size={18} color={tertiary} style={styles.icon} />
        <TextInput
          ref={canteenRef}
          style={[styles.input, { color: colors.text }]}
          placeholder="Canteen name"
          placeholderTextColor={tertiary}
          value={canteenName}
          onChangeText={(t) => {
            setCanteenName(t);
            if (canteenError) setCanteenError('');
          }}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          editable={preOtpEditable}
          returnKeyType="next"
          blurOnSubmit={false}
          onFocus={() => scrollFocusedIntoView(canteenRef)}
          onSubmitEditing={() => emailRef.current?.focus()}
          accessibilityLabel="Canteen name"
        />
      </View>
      {canteenError ? (
        <Text style={[styles.fieldError, { color: colors.error }]}>{canteenError}</Text>
      ) : null}

      <EmailVerificationSection
        email={email}
        onEmailChange={setEmail}
        colors={colors}
        onSendOtp={handleSendOtp}
        onVerifyOtp={handleVerifyOtp}
        describeError={describeError}
        emailInputRef={emailRef}
        onEmailFocus={() => scrollFocusedIntoView(emailRef)}
        onEmailSubmitEditing={() => {
          // Stay on email / send OTP — password unlocks only after verify.
        }}
        sendEnabled={!!fullName.trim() && !!canteenName.trim() && emailLooksValid && !submitting}
        onVerifiedChange={(v) => {
          setEmailVerified(v);
          if (v) {
            setOtpAwaitingCode(false);
            setGeneralSuccess('Email verified. Set your password to finish.');
            setGeneralError('');
          } else {
            clearPendingSignup?.();
            setOtpAwaitingCode(false);
            setGeneralSuccess('');
          }
        }}
        onOtpSent={() => {
          setOtpAwaitingCode(true);
          // Drop any stray focus (username / autofill) so OTP can take the keyboard.
          nameRef.current?.blur?.();
          canteenRef.current?.blur?.();
          emailRef.current?.blur?.();
          passwordRef.current?.blur?.();
          confirmRef.current?.blur?.();
          setGeneralSuccess('');
          setGeneralError('');
        }}
        resendSeconds={60}
        disabled={submitting}
        style={{ marginBottom: 8 }}
      />

      {/* Post-OTP: password + confirm — locked until verified */}
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
            {
              backgroundColor: passwordLocked
                ? colors.mutedRowBackground || colors.inputBackground
                : colors.inputBackground,
              borderColor: colors.border,
            },
            showPasswordMissing || passwordError ? { borderColor: colors.error } : null,
          ]}
        >
          <AppIcon name="lock-closed-outline" size={18} color={tertiary} style={styles.icon} />
          <TextInput
            ref={passwordRef}
            style={[styles.input, { color: colors.text }]}
            placeholder={passwordLocked ? 'Password (verify email first)' : 'Password'}
            placeholderTextColor={tertiary}
            value={password}
            onChangeText={(t) => {
              if (passwordLocked) return;
              setPassword(t);
              if (passwordError) setPasswordError('');
            }}
            secureTextEntry={!passwordVisible}
            autoCapitalize="none"
            autoComplete={passwordLocked ? 'off' : 'new-password'}
            textContentType={passwordLocked ? 'none' : 'newPassword'}
            importantForAutofill={passwordLocked ? 'no' : 'yes'}
            showSoftInputOnFocus={!passwordLocked}
            editable={postOtpUnlocked}
            returnKeyType="next"
            blurOnSubmit={false}
            accessibilityLabel="Password"
            accessibilityState={{ disabled: passwordLocked }}
            onFocus={() => {
              if (passwordLocked) {
                // Do not bounce focus to username — that steals the OTP keyboard.
                passwordRef.current?.blur?.();
                return;
              }
              scrollFocusedIntoView(passwordRef);
            }}
            onBlur={() => setPasswordTouched(true)}
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
        {showPasswordMissing || passwordError ? (
          <View style={styles.passwordMissingRow} accessibilityLiveRegion="polite">
            <AppIcon name="close-circle" size={16} color={colors.error} style={undefined} />
            <Text style={[styles.fieldErrorInline, { color: colors.error }]}>
              {passwordError || 'Password is missing'}
            </Text>
          </View>
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
            {
              backgroundColor: passwordLocked
                ? colors.mutedRowBackground || colors.inputBackground
                : colors.inputBackground,
              borderColor: colors.border,
            },
            confirmError || (confirmHint && !confirmHint.ok) ? { borderColor: colors.error } : null,
            confirmHint?.ok ? { borderColor: okGreen } : null,
          ]}
        >
          <AppIcon name="lock-closed-outline" size={18} color={tertiary} style={styles.icon} />
          <TextInput
            ref={confirmRef}
            style={[styles.input, { color: colors.text }]}
            placeholder={
              passwordLocked ? 'Confirm Password (verify email first)' : 'Confirm Password'
            }
            placeholderTextColor={tertiary}
            value={confirmPassword}
            onChangeText={(t) => {
              if (passwordLocked) return;
              setConfirmPassword(t);
              if (confirmError) setConfirmError('');
            }}
            secureTextEntry={!confirmVisible}
            autoCapitalize="none"
            autoComplete={passwordLocked ? 'off' : 'new-password'}
            textContentType={passwordLocked ? 'none' : 'newPassword'}
            importantForAutofill={passwordLocked ? 'no' : 'yes'}
            showSoftInputOnFocus={!passwordLocked}
            editable={postOtpUnlocked}
            returnKeyType="done"
            accessibilityLabel="Confirm password"
            accessibilityState={{ disabled: passwordLocked }}
            onFocus={() => {
              if (passwordLocked) {
                confirmRef.current?.blur?.();
                return;
              }
              scrollFocusedIntoView(confirmRef);
            }}
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
      </Animated.View>

      {/* Terms: checkbox gated by OTP; "Terms of Service" always tappable */}
      <View style={styles.termsRow}>
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
              passwordLocked && { opacity: 0.45 },
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
  passwordMissingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -6,
    marginBottom: 10,
    marginLeft: 4,
  },
  fieldErrorInline: {
    fontSize: 12,
    fontFamily: appTypography.regular,
    flexShrink: 1,
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
