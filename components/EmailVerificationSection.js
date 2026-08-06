import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import AppIcon from './AppIcon';
import OTPInput from './OTPInput';
import CountdownTimer from './CountdownTimer';

const BRAND_GOLD = '#D4A017';
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const OTP_LENGTH = 6;
const DEFAULT_RESEND_SECONDS = 120;

/**
 * Email + Send OTP / Resend countdown + inline OTP boxes with auto-verify.
 */
export default function EmailVerificationSection({
  email,
  onEmailChange,
  colors,
  onSendOtp,
  onVerifyOtp,
  describeError,
  onVerifiedChange,
  onOtpSent,
  sendEnabled = true,
  resendSeconds = DEFAULT_RESEND_SECONDS,
  disabled = false,
  style,
  emailInputRef = null,
  onEmailFocus,
  onEmailSubmitEditing,
}) {
  const [emailError, setEmailError] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [sentBanner, setSentBanner] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);

  const revealAnim = useRef(new Animated.Value(0)).current;
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const verifyingLock = useRef(false);
  const lastTriedCode = useRef('');

  const setVerifiedState = useCallback(
    (v) => {
      setVerified(v);
      onVerifiedChange?.(v);
    },
    [onVerifiedChange]
  );

  const animateReveal = useCallback(
    (show) => {
      // Opacity + translateY only — maxHeight is not supported with the native driver
      // and was throwing "Style property 'maxHeight' is not supported".
      Animated.timing(revealAnim, {
        toValue: show ? 1 : 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
    [revealAnim]
  );

  const showSentBanner = useCallback(() => {
    setSentBanner(true);
    bannerAnim.setValue(0);
    Animated.timing(bannerAnim, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [bannerAnim]);

  const validateEmail = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return 'Please enter your email address.';
    if (!EMAIL_RE.test(trimmed)) return 'Please enter a valid email address.';
    return '';
  };

  const handleSend = async () => {
    if (sending || verifying || verified || disabled || !sendEnabled) return;
    setEmailError('');
    setOtpError('');
    const err = validateEmail(email);
    if (err) {
      setEmailError(err);
      return;
    }
    setSending(true);
    try {
      const result = await onSendOtp(email.trim());
      if (result?.error) {
        setEmailError(describeError(result.error, 'send'));
        return;
      }
      setOtp('');
      lastTriedCode.current = '';
      setOtpSent(true);
      setTimerRunning(true);
      setRestartKey((k) => k + 1);
      setVerifiedState(false);
      animateReveal(true);
      showSentBanner();
      onOtpSent?.();
    } catch (e) {
      setEmailError(describeError(e, 'send'));
    } finally {
      setSending(false);
    }
  };

  const handleResend = async () => {
    if (sending || verifying || verified || disabled) return;
    setOtpError('');
    setSending(true);
    try {
      const result = await onSendOtp(email.trim());
      if (result?.error) {
        setOtpError(describeError(result.error, 'send'));
        return;
      }
      setOtp('');
      lastTriedCode.current = '';
      setTimerRunning(true);
      setRestartKey((k) => k + 1);
      showSentBanner();
    } catch (e) {
      setOtpError(describeError(e, 'send'));
    } finally {
      setSending(false);
    }
  };

  const resetForEmailChange = () => {
    setOtpSent(false);
    setOtp('');
    setOtpError('');
    setEmailError('');
    setSentBanner(false);
    setTimerRunning(false);
    setVerifiedState(false);
    lastTriedCode.current = '';
    verifyingLock.current = false;
    animateReveal(false);
  };

  const handleChangeEmail = () => {
    if (disabled) return;
    Alert.alert('Change email?', 'Changing email will cancel the current verification.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Change Email',
        style: 'destructive',
        onPress: resetForEmailChange,
      },
    ]);
  };

  const runVerify = useCallback(
    async (code) => {
      if (verifyingLock.current || verified || disabled) return;
      if (code.length !== OTP_LENGTH) return;
      if (lastTriedCode.current === code) return;
          lastTriedCode.current = code;
      verifyingLock.current = true;
      setVerifying(true);
      setOtpError('');
      try {
        const result = await onVerifyOtp(email.trim(), code);
        if (result?.error) {
          setOtpError(describeError(result.error, 'verify'));
          return;
        }
        setVerifiedState(true);
        setTimerRunning(false);
        setSentBanner(false);
      } catch (e) {
        setOtpError(describeError(e, 'verify'));
      } finally {
        setVerifying(false);
        verifyingLock.current = false;
      }
    },
    [verified, disabled, onVerifyOtp, email, describeError, setVerifiedState]
  );

  useEffect(() => {
    if (!otpSent || verified || otp.length !== OTP_LENGTH) return;
    const t = setTimeout(() => runVerify(otp), 100);
    return () => clearTimeout(t);
  }, [otp, otpSent, verified, runVerify]);

  const emailLocked = otpSent || verified;
  const tertiary = colors.textTertiary || '#9CA3AF';

  return (
    <View style={style}>
      <View
        style={[
          styles.emailRow,
          {
            backgroundColor: colors.inputBackground,
            borderColor: emailError ? colors.error : colors.border,
          },
          emailLocked && styles.emailRowLocked,
        ]}
      >
        <AppIcon
          name={emailLocked ? 'lock-closed-outline' : 'mail-outline'}
          size={18}
          color={tertiary}
          style={styles.emailIcon}
        />
        <TextInput
          ref={emailInputRef}
          style={[styles.emailInput, { color: colors.text }, emailLocked && styles.emailInputLocked]}
          placeholder="Email"
          placeholderTextColor={tertiary}
          value={email}
          onChangeText={(t) => {
            onEmailChange(t);
            if (emailError) setEmailError('');
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          editable={!emailLocked && !disabled && !sending}
          returnKeyType="next"
          blurOnSubmit={false}
          onFocus={onEmailFocus}
          onSubmitEditing={() => {
            if (typeof onEmailSubmitEditing === 'function') {
              onEmailSubmitEditing();
            } else if (!otpSent && !verified && sendEnabled && !sending && !disabled) {
              handleSend();
            }
          }}
          accessibilityLabel="Email address"
        />
        {!otpSent && !verified ? (
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (sending || disabled || !sendEnabled) && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={sending || disabled || !sendEnabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: sending || disabled || !sendEnabled, busy: sending }}
            accessibilityLabel={sending ? 'Sending code' : 'Send OTP'}
          >
            {sending ? (
              <View style={styles.sendBusy}>
                <ActivityIndicator size="small" color="#111" />
                <Text style={styles.sendBtnText}>Sending...</Text>
              </View>
            ) : (
              <Text style={styles.sendBtnText}>Send OTP</Text>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
      {emailError ? <Text style={[styles.fieldError, { color: colors.error }]}>{emailError}</Text> : null}

      {sentBanner && !verified ? (
        <Animated.View
          style={[
            styles.banner,
            {
              opacity: bannerAnim,
              transform: [
                {
                  translateY: bannerAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-6, 0],
                  }),
                },
              ],
            },
          ]}
          accessibilityLiveRegion="polite"
        >
          <AppIcon name="checkmark-circle" size={16} color="#16A34A" style={undefined} />
          <Text style={styles.bannerText}>Verification code sent</Text>
        </Animated.View>
      ) : null}

      {otpSent ? (
        <Animated.View
          style={{
            opacity: revealAnim,
            transform: [
              {
                translateY: revealAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-12, 0],
                }),
              },
            ],
          }}
          pointerEvents="auto"
        >
          <View style={styles.otpBlock}>
            <Text style={[styles.otpLabel, { color: colors.text }]}>Verification Code</Text>

            {verified ? (
              <View style={styles.verifiedRow} accessibilityLiveRegion="polite">
                <AppIcon name="checkmark-circle" size={18} color="#16A34A" style={undefined} />
                <Text style={styles.verifiedText}>Code Verified</Text>
              </View>
            ) : (
              <>
                <OTPInput
                  value={otp}
                  onChange={(next) => {
                    setOtp(next);
                    if (otpError) setOtpError('');
                    // New digits → allow verify again (same wrong code stays blocked).
                    if (next !== lastTriedCode.current) {
                      lastTriedCode.current = '';
                    }
                  }}
                  length={OTP_LENGTH}
                  disabled={verifying || disabled}
                  error={!!otpError}
                  autoFocus
                  focusKey={restartKey}
                  accentColor={BRAND_GOLD}
                  borderColor={colors.border}
                  errorColor={colors.error}
                  backgroundColor={colors.inputBackground}
                  textColor={colors.text}
                />
                {verifying ? (
                  <View style={styles.verifyingRow}>
                    <ActivityIndicator size="small" color={BRAND_GOLD} />
                    <Text style={[styles.verifyingText, { color: colors.textSecondary }]}>
                      Verifying...
                    </Text>
                  </View>
                ) : null}
                {otpError ? (
                  <Text style={[styles.fieldError, { color: colors.error }]}>{otpError}</Text>
                ) : null}

                <View style={styles.resendWrap}>
                  <CountdownTimer
                    seconds={resendSeconds}
                    restartKey={restartKey}
                    running={timerRunning && !verified}
                    readyLabel="Resend OTP"
                    countingLabel={(t) => `Resend OTP in ${t}`}
                    onPressReady={handleResend}
                    disabled={sending || verifying || disabled}
                    readyTextStyle={{ color: BRAND_GOLD }}
                    textStyle={{ color: tertiary }}
                  />
                </View>
              </>
            )}

            {!verified ? (
              <TouchableOpacity
                onPress={handleChangeEmail}
                disabled={disabled || sending || verifying}
                style={styles.changeEmail}
                accessibilityRole="button"
                accessibilityLabel="Change email"
              >
                <Text style={styles.changeEmailText}>Change Email</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    paddingLeft: 12,
    paddingRight: 6,
    minHeight: 52,
  },
  emailRowLocked: {
    opacity: 0.92,
  },
  emailIcon: {
    marginRight: 8,
  },
  emailInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 12,
  },
  emailInputLocked: {
    opacity: 0.85,
  },
  sendBtn: {
    backgroundColor: BRAND_GOLD,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginLeft: 6,
    minHeight: 40,
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.7,
  },
  sendBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sendBtnText: {
    color: '#111111',
    fontWeight: '700',
    fontSize: 13,
  },
  fieldError: {
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  bannerText: {
    color: '#16A34A',
    fontWeight: '600',
    fontSize: 13,
  },
  otpBlock: {
    marginTop: 14,
  },
  otpLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  verifyingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  verifyingText: {
    fontSize: 13,
    fontWeight: '500',
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  verifiedText: {
    color: '#16A34A',
    fontWeight: '700',
    fontSize: 15,
  },
  resendWrap: {
    marginTop: 14,
    alignItems: 'center',
  },
  changeEmail: {
    marginTop: 12,
    alignItems: 'center',
  },
  changeEmailText: {
    color: BRAND_GOLD,
    fontWeight: '600',
    fontSize: 14,
  },
});
