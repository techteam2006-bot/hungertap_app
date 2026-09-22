import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import ConfirmModal from '../components/ConfirmModal';

const AppAlertContext = createContext(null);

/**
 * Global app-styled alerts (single OK) so CartContext / screens avoid native Alert.alert.
 */
export function AppAlertProvider({ children }) {
  const [alertState, setAlertState] = useState(null);

  const hideAppAlert = useCallback(() => {
    setAlertState((prev) => {
      prev?.onClose?.();
      return null;
    });
  }, []);

  const showAppAlert = useCallback((title, message, options = {}) => {
    const next = {
      title: title || '',
      message: message || '',
      confirmLabel: options.confirmLabel || 'OK',
      onClose: typeof options.onClose === 'function' ? options.onClose : null,
    };
    // Defer so callers inside setState updaters don't clash with React render.
    setTimeout(() => setAlertState(next), 0);
  }, []);

  const value = useMemo(
    () => ({
      showAppAlert,
      hideAppAlert,
    }),
    [showAppAlert, hideAppAlert]
  );

  return (
    <AppAlertContext.Provider value={value}>
      {children}
      <ConfirmModal
        visible={!!alertState}
        title={alertState?.title}
        message={alertState?.message}
        confirmLabel={alertState?.confirmLabel || 'OK'}
        mode="alert"
        onCancel={hideAppAlert}
        onConfirm={hideAppAlert}
      />
    </AppAlertContext.Provider>
  );
}

export function useAppAlert() {
  const ctx = useContext(AppAlertContext);
  if (!ctx) {
    throw new Error('useAppAlert must be used within an AppAlertProvider');
  }
  return ctx;
}

/** Optional access when provider may be missing (fallback no-op). */
export function useAppAlertOptional() {
  return useContext(AppAlertContext);
}
