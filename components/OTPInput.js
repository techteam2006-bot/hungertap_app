import React, { useRef, useCallback, useEffect } from 'react';
import { View, TextInput, StyleSheet, Text, Pressable } from 'react-native';

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
  const digits = String(value || '')
    .replace(/\D/g, '')
    .slice(0, length);

  useEffect(() => {
    if (autoFocus && !disabled) {
      const t = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [autoFocus, disabled]);

  const handleChange = useCallback(
    (text) => {
      const next = String(text || '')
        .replace(/\D/g, '')
        .slice(0, length);
      onChange(next);
    },
    [length, onChange]
  );

  const focusHidden = () => {
    if (!disabled) inputRef.current?.focus();
  };

  return (
    <Pressable
      onPress={focusHidden}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <View style={styles.row}>
        {Array.from({ length }).map((_, i) => {
          const digit = digits[i] || '';
          const isActive = !disabled && i === Math.min(digits.length, length - 1);
          return (
            <View
              key={i}
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
      </View>
      <TextInput
        ref={inputRef}
        value={digits}
        onChangeText={handleChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        editable={!disabled}
        caretHidden
        importantForAutofill="yes"
        style={styles.hidden}
        accessibilityLabel={accessibilityLabel}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
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
  hidden: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
  },
});
