import React, { useRef, useCallback, useEffect } from 'react';
import { View, TextInput, StyleSheet, Text, Pressable, Platform, Keyboard } from 'react-native';

const DEFAULT_LENGTH = 6;

/**
 * 6-box OTP input with auto-advance, backspace, and paste support.
 */
export default function OTPInput({
  value,
  onChange,
  length = DEFAULT_LENGTH,
  disabled = false,
  error = false,
  autoFocus = false,
  focusKey = 0,
  accessibilityLabel = 'Verification code',
  boxStyle,
  digitStyle,
  accentColor = '#D4A017',
  borderColor = '#E5E7EB',
  errorColor = '#EF4444',
  backgroundColor = '#F9FAFB',
  textColor = '#111827',
}) {
  const inputRef = useRef(null);
  const keyboardVisibleRef = useRef(false);
  const digits = String(value || '')
    .replace(/\D/g, '')
    .slice(0, length);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => {
      keyboardVisibleRef.current = true;
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardVisibleRef.current = false;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const focusInput = useCallback(() => {
    if (disabled) return;
    const input = inputRef.current;
    if (!input) return;

    const alreadyFocused = typeof input.isFocused === 'function' ? input.isFocused() : false;

    // Android often dismisses the keyboard without blurring. Calling focus()
    // is then a no-op — blur first, then focus again to reopen the keyboard.
    if (alreadyFocused && !keyboardVisibleRef.current) {
      input.blur();
      requestAnimationFrame(() => {
        setTimeout(() => inputRef.current?.focus(), Platform.OS === 'android' ? 40 : 0);
      });
      return;
    }

    if (!alreadyFocused) {
      input.focus();
    }
  }, [disabled]);

  useEffect(() => {
    if (autoFocus && !disabled) {
      // Delay past signup reveal animation / stray field focus so OTP keeps the keyboard.
      const t = setTimeout(() => focusInput(), 380);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [autoFocus, disabled, focusKey, focusInput]);

  const handleChange = useCallback(
    (text) => {
      const next = String(text || '')
        .replace(/\D/g, '')
        .slice(0, length);
      onChange(next);
    },
    [length, onChange]
  );

  return (
    <Pressable
      onPress={focusInput}
      disabled={disabled}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <View style={styles.row} pointerEvents="box-none">
        {Array.from({ length }).map((_, i) => {
          const digit = digits[i] || '';
          const isActive = !disabled && i === Math.min(digits.length, length - 1);
          return (
            <View
              key={i}
              pointerEvents="none"
              style={[
                styles.box,
                {
                  borderColor: error ? errorColor : isActive || digit ? accentColor : borderColor,
                  backgroundColor,
                },
                boxStyle,
              ]}
            >
              <Text style={[styles.digit, { color: textColor }, digitStyle]}>{digit}</Text>
            </View>
          );
        })}
        <TextInput
          ref={inputRef}
          value={digits}
          onChangeText={handleChange}
          onPressIn={focusInput}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={length}
          editable={!disabled}
          showSoftInputOnFocus
          caretHidden
          importantForAutofill="yes"
          style={styles.hiddenOverlay}
          accessibilityLabel={accessibilityLabel}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    position: 'relative',
  },
  box: {
    flex: 1,
    maxWidth: 48,
    aspectRatio: 0.92,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  // Covers the digit boxes so taps always hit a real TextInput.
  hiddenOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.02,
    color: 'transparent',
  },
});
