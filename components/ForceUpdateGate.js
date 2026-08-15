import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AuthLoadingScreen from '../screens/AuthLoadingScreen';
import ForceUpdateScreen from '../screens/ForceUpdateScreen';
import { evaluateForceUpdateRequired } from '../lib/appVersionCheck';
import { useAuth } from '../lib/AuthContext';

/**
 * Blocks the app when the installed build is below the user's college
 * `min_app_version`. Re-checks on resume and when the signed-in user changes.
 */
export default function ForceUpdateGate({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [phase, setPhase] = useState('checking');
  const [meta, setMeta] = useState({ installed: '', minimumVersion: '' });
  const checkInFlight = useRef(false);
  /** Set when the server has definitively reported installed < minimum. */
  const lastDefinitiveBlock = useRef(false);

  const runCheck = useCallback(async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    try {
      const result = await evaluateForceUpdateRequired();
      if (result.required) {
        lastDefinitiveBlock.current = true;
        setMeta({
          installed: result.installed,
          minimumVersion: result.minimumVersion || '',
        });
        setPhase('blocked');
        return;
      }
      // Fail-open on launch/resume — except when we already know this build is outdated.
      if (result.checkFailed && lastDefinitiveBlock.current) {
        return;
      }
      lastDefinitiveBlock.current = false;
      setPhase('supported');
    } catch (_) {
      if (!lastDefinitiveBlock.current) {
        setPhase('supported');
      }
    } finally {
      checkInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (authLoading) return undefined;
    runCheck();
  }, [runCheck, authLoading, user?.id]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        runCheck();
      }
    });
    return () => sub.remove();
  }, [runCheck]);

  if (phase === 'checking' || authLoading) {
    return <AuthLoadingScreen message="Checking for updates..." />;
  }

  if (phase === 'blocked') {
    return (
      <ForceUpdateScreen
        installedVersion={meta.installed}
        minimumVersion={meta.minimumVersion}
      />
    );
  }

  return children;
}
