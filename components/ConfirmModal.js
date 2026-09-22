import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../lib/ThemeContext';
import { appTypography } from '../lib/darkThemeConfig';

/**
 * App-styled confirmation / info dialog (replaces native Alert.alert).
 * mode="confirm" — Cancel + Confirm
 * mode="alert" — single OK (confirm) button
 */
export default function ConfirmModal({
  visible,
  title,
  message,
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  onCancel,
  onConfirm,
  confirmDestructive = false,
  busy = false,
  dismissOnBackdrop = true,
  mode = 'confirm',
}) {
  const { colors } = useTheme();
  const isAlert = mode === 'alert';

  const handleRequestClose = () => {
    if (busy) return;
    onCancel?.();
  };

  const confirmGradient = confirmDestructive
    ? ['#FF5C5C', '#B91C1C']
    : [colors.brandYellow || '#F5B041', '#D4A017'];

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="fade"
      onRequestClose={handleRequestClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={dismissOnBackdrop && !busy ? handleRequestClose : undefined}
        />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.elevatedSurface, borderColor: colors.border },
          ]}
        >
          {title ? (
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          ) : null}
          {message ? (
            <Text style={[styles.body, { color: colors.textSecondary }]}>{message}</Text>
          ) : null}
          <View style={styles.actions}>
            {!isAlert ? (
              <TouchableOpacity
                onPress={handleRequestClose}
                disabled={busy}
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.cancelLabel, { color: colors.textSecondary }]}>
                  {cancelLabel}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={onConfirm}
              disabled={busy}
              activeOpacity={0.88}
              style={[styles.confirmTouchable, isAlert && styles.confirmTouchableAlone]}
            >
              <LinearGradient
                colors={confirmGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.confirmGradient}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmLabel}>{confirmLabel}</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    zIndex: 1,
  },
  title: {
    fontSize: 18,
    fontFamily: appTypography.bold,
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    fontFamily: appTypography.regular,
    lineHeight: 20,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    fontSize: 15,
    fontFamily: appTypography.semiBold,
  },
  confirmTouchable: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  confirmTouchableAlone: {
    flex: 1,
  },
  confirmGradient: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  confirmLabel: {
    fontSize: 15,
    fontFamily: appTypography.semiBold,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
