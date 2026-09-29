import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * true while the app is in the foreground.
 *
 * Screens use this to close their Supabase Realtime channel when the phone
 * goes to the background (and re-open + refetch when it comes back), so a
 * backgrounded phone on a weak campus network does not keep a Realtime
 * connection — and its reconnect attempts — open on the backend.
 */
export default function useAppActive() {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // 'inactive' is a brief iOS transition (e.g. control centre) — only treat 'background' as away.
      if (state === 'active') setActive(true);
      else if (state === 'background') setActive(false);
    });
    return () => sub.remove();
  }, []);
  return active;
}
