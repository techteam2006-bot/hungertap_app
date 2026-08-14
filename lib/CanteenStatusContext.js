import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { Alert } from 'react-native';
import canteenStatusService from './CanteenStatusService';
import { useAuth } from './AuthContext';
import { MSG_COULD_NOT_FETCH_DATA, MSG_POOR_NETWORK } from './orderFlowErrors';
import { getCachedCanteenStatus, setCachedCanteenStatus, clearCachedCanteenStatus } from './settingsCache';

const CanteenStatusContext = createContext();

/** @typedef {{ isOpen: boolean, loading: boolean, statusKnownFromServer: boolean, closureReason: 'kitchen_closed'|'orders_paused'|null }} CanteenStatusState */

export const CanteenStatusProvider = ({ children }) => {
  const { user } = useAuth();
  const [canteenStatus, setCanteenStatus] = useState(() => ({
    isOpen: true,
    loading: true,
    statusKnownFromServer: false,
    closureReason: null,
  }));

  /**
   * @param {{ showAlertOnFailure?: boolean }} [options]
   * showAlertOnFailure — e.g. “Check again” on the closed-kitchen UI; avoids spam on mount / pull refresh.
   */
  const checkCanteenStatus = useCallback(async (options = {}) => {
    const { showAlertOnFailure = false } = options;
    setCanteenStatus((prev) => ({ ...prev, loading: true }));
    try {
      // Offline hint only: never paint "closed" from cache — that blocks ordering incorrectly.
      if (user?.id) {
        try {
          const cached = await getCachedCanteenStatus(user.id);
          if (cached?.isOpen) {
            setCanteenStatus((prev) => ({
              ...prev,
              isOpen: true,
              loading: true,
              statusKnownFromServer: false,
              closureReason: null,
            }));
          } else if (cached && cached.isOpen === false && cached.statusKnownFromServer) {
            setCanteenStatus((prev) => ({
              ...prev,
              isOpen: false,
              loading: true,
              statusKnownFromServer: true,
              closureReason: cached.closureReason || prev.closureReason || 'kitchen_closed',
            }));
          }
        } catch (_) {}
      }

      const result = await canteenStatusService.checkCanteenStatus(null, user?.id ?? null);

      if (result.ok) {
        setCanteenStatus({
          isOpen: !!result.isOpen,
          loading: false,
          statusKnownFromServer: true,
          closureReason: result.isOpen ? null : result.closureReason || 'kitchen_closed',
        });
        if (user?.id) {
          setCachedCanteenStatus(user.id, !!result.isOpen, result.closureReason).catch(() => {});
        }
        return result;
      }

      setCanteenStatus({
        isOpen: true,
        loading: false,
        statusKnownFromServer: false,
        closureReason: null,
      });

      if (showAlertOnFailure) {
        Alert.alert(
          result.errorKind === 'network' ? MSG_POOR_NETWORK : MSG_COULD_NOT_FETCH_DATA
        );
      }
      return result;
    } catch (error) {
      console.warn('checkCanteenStatus:', error?.message || error);
      setCanteenStatus((prev) => ({ ...prev, loading: false }));
      if (showAlertOnFailure) {
        Alert.alert(MSG_COULD_NOT_FETCH_DATA);
      }
      return null;
    }
  }, [user?.id]);

  useEffect(() => {
    // Guest / Login: skip network + Realtime (avoids offline LogBox noise).
    if (!user?.id) {
      setCanteenStatus({
        isOpen: true,
        loading: false,
        statusKnownFromServer: false,
        closureReason: null,
      });
      return undefined;
    }

    checkCanteenStatus();

    // No Realtime — refresh when app/user context remounts; Home can call check on focus.
    return undefined;
  }, [user?.id, checkCanteenStatus]);

  return (
    <CanteenStatusContext.Provider
      value={{
        canteenStatus,
        checkCanteenStatus,
      }}
    >
      {children}
    </CanteenStatusContext.Provider>
  );
};

export const useCanteenStatus = () => {
  const context = useContext(CanteenStatusContext);
  if (!context) {
    throw new Error('useCanteenStatus must be used within a CanteenStatusProvider');
  }
  return context;
};
