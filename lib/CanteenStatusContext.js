import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { Alert } from 'react-native';
import canteenStatusService from './CanteenStatusService';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';
import { MSG_COULD_NOT_FETCH_DATA, MSG_POOR_NETWORK } from './orderFlowErrors';

const CanteenStatusContext = createContext();

/** @typedef {{ isOpen: boolean, loading: boolean, statusKnownFromServer: boolean }} CanteenStatusState */

export const CanteenStatusProvider = ({ children }) => {
  const { user } = useAuth();
  const [canteenStatus, setCanteenStatus] = useState(() => ({
    isOpen: true,
    loading: true,
    statusKnownFromServer: false,
  }));

  /**
   * @param {{ showAlertOnFailure?: boolean }} [options]
   * showAlertOnFailure — e.g. “Check again” on the closed-kitchen UI; avoids spam on mount / pull refresh.
   */
  const checkCanteenStatus = useCallback(async (options = {}) => {
    const { showAlertOnFailure = false } = options;
    setCanteenStatus((prev) => ({ ...prev, loading: true }));
    try {
      const result = await canteenStatusService.checkCanteenStatus(null, user?.id ?? null);

      if (result.ok) {
        setCanteenStatus({
          isOpen: !!result.isOpen,
          loading: false,
          statusKnownFromServer: true,
        });
        return result;
      }

      setCanteenStatus((prev) => ({ ...prev, loading: false }));

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
    checkCanteenStatus();

    const subscription = canteenStatusService.subscribeToCanteenStatus((newStatus) => {
      try {
        console.log('📡 Real-time canteen status update:', newStatus?.is_open ? 'OPEN' : 'CLOSED');
        setCanteenStatus({
          isOpen: !!newStatus?.is_open,
          loading: false,
          statusKnownFromServer: true,
        });
      } catch (e) {
        console.warn('Canteen status callback:', e);
      }
    });

    return () => {
      if (subscription) {
        try {
          supabase.removeChannel(subscription);
        } catch (e) {
          try {
            if (typeof subscription.unsubscribe === 'function') {
              subscription.unsubscribe();
            }
          } catch (_) {}
        }
      }
    };
  }, [checkCanteenStatus]);

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
