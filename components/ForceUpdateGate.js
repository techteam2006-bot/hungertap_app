import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AuthLoadingScreen from '../screens/AuthLoadingScreen';
import ForceUpdateScreen from '../screens/ForceUpdateScreen';
import { evaluateForceUpdateRequired } from '../lib/appVersionCheck';

/**
 * Blocks the app before auth/navigation when the installed build is below the
 * server minimum. Re-checks whenever the app returns to the foreground.
 */
export default function ForceUpdateGate({ children }) {
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
    runCheck();
  }, [runCheck]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        runCheck();
      }
    });
    return () => sub.remove();
  }, [runCheck]);

  if (phase === 'checking') {
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
