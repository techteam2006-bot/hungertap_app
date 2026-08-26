import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';

function formatMmSs(total) {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/**
 * Countdown that exposes a pressable "Resend" action when finished.
 */
export default function CountdownTimer({
  seconds,
  restartKey = 0,
  running = true,
  onComplete,
  countingLabel = (t) => `Resend Code in ${t}`,
  readyLabel = 'Resend Code',
  onPressReady,
  disabled = false,
  textStyle,
  readyTextStyle,
  accessibilityLabel,
}) {
  const [remaining, setRemaining] = useState(seconds);
  const completedRef = useRef(false);

  useEffect(() => {
    setRemaining(seconds);
    completedRef.current = false;
  }, [seconds, restartKey]);

  useEffect(() => {
    if (!running || remaining <= 0) {
      if (remaining <= 0 && !completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
      return undefined;
    }
    const id = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [running, remaining, onComplete]);

  if (remaining > 0) {
    const formatted = formatMmSs(remaining);
    return (
      <Text
        style={[styles.counting, textStyle]}
        accessibilityLabel={accessibilityLabel || countingLabel(formatted)}
      >
        {countingLabel(formatted)}
      </Text>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPressReady}
      disabled={disabled || !onPressReady}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || readyLabel}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={[styles.ready, readyTextStyle]}>{readyLabel}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  counting: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
    textAlign: 'center',
  },
  ready: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D4A017',
    textAlign: 'center',
  },
});
