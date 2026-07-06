import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';
import {
  ACCOUNT_EXISTS_MESSAGE,
  ALREADY_SIGNED_IN_CODE,
  ALREADY_SIGNED_IN_MESSAGE,
  AUTH_EMAIL_DUPLICATE_CODE,
  rpcAuthEmailExistsResultIsTrue,
} from './authErrorMessages';

// ─── Context ─────────────────────────────────────────────────────────────────
const AuthContext = createContext(null);

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};

// Keep backward-compatible alias
export const useAuth = useAuthContext;

export function AuthProvider({ children }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [authProfileReady, setAuthProfileReady] = useState(false);
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Initialize auth state
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        // ✅ error handled
        if (error) {
          console.error('Auth getSession:', error.message || error);
        }
        const session = data?.session || null;
        if (session && mounted) {
          const u = session.user || null;
          setUser(u);
          setUserId(u?.id || null);
          setIsSignedIn(true);
          setAuthProfileReady(false);
          await syncProfileAndRole(u?.id);
          setAuthProfileReady(true);
        } else if (mounted) {
          setAuthProfileReady(true);
        }
      } catch (e) {
        console.error('Auth init error:', e);
        if (mounted) setAuthProfileReady(true);
      } finally {
        if (mounted) setIsLoaded(true);
      }
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        // ✅ error handled — auth listener must never throw into Supabase client
        if (event === 'SIGNED_IN' && session?.user) {
          const u = session.user;
          setUser(u);
          setUserId(u?.id ?? null);
          setIsSignedIn(true);
          setAuthProfileReady(false);
          await syncProfileAndRole(u?.id);
          setAuthProfileReady(true);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setUserId(null);
          setIsSignedIn(false);
          setProfile(null);
          setUserRole(null);
          setAuthProfileReady(true);
        }
      } catch (e) {
        console.error('onAuthStateChange:', e);
        setAuthProfileReady(true);
      }
    });

    return () => {
      mounted = false;
      if (listener && listener.subscription) {
        listener.subscription.unsubscribe();
      }
    };
  }, []);

  /**
   * Ensures `public.users` (and related) rows for this account — mirrors DB logic used on signup.
   * Requires Postgres function `create_user_profile_from_auth(p_user_id uuid)` for `authenticated`.
   */
  async function invokeCreateUserProfileFromAuth(authUserId) {
    if (!authUserId) return;
    try {
      const { error } = await supabase.rpc('create_user_profile_from_auth', {
        p_user_id: authUserId,
      });
      if (error) {
        console.error('RPC Error:', error.message || error);
      }
    } catch (err) {
      console.error('Unexpected Error:', err);
    }
  }

  async function syncProfileAndRole(id) {
    if (!id) return;
    setLoadingProfile(true);
    const PROFILE_SYNC_TIMEOUT_MS = 15000;
    try {
      await Promise.race([
        (async () => {
          const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', id)
            .maybeSingle();

          if (error) {
            console.warn('syncProfile error:', error);
            setProfile(null);
            setUserRole(null);
          } else if (data) {
            setProfile(data);
            const role = data.role || null;
            setUserRole(role);
            if (role && role !== 'student') {
              await handleSignOut();
              setAuthError('Access denied. This app is only for students.');
            }
          } else {
            await invokeCreateUserProfileFromAuth(id);
            setProfile(null);
            setUserRole(null);
          }
        })(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Object.assign(new Error('Profile sync timed out'), { code: 'PROFILE_SYNC_TIMEOUT' })),
            PROFILE_SYNC_TIMEOUT_MS
          )
        ),
      ]);
    } catch (e) {
      if (e?.code === 'PROFILE_SYNC_TIMEOUT') {
        console.warn('Profile sync timed out; continuing without profile.');
        setProfile(null);
        setUserRole(null);
      } else {
        console.error('syncProfile:', e);
      }
    } finally {
      setLoadingProfile(false);
    }
  }

  // ─── Auth methods (Supabase) ────────────────────────────────────────────────
  async function signInWithPassword(email, password) {
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError(error.message);
        return { data: null, error };
      }
      // data.session present => signed in
      if (data?.session?.user) {
        const u = data.session.user;
        // `u.id` is the auth.users UUID — required shape for `p_user_id`
        await invokeCreateUserProfileFromAuth(u.id);
      }
      return { data, error: null };
    } catch (e) {
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  async function signInWithMagicLink(email) {
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithOtp({ email });
      if (error) {
        setAuthError(error.message);
        return { error };
      }
      return { data, pending: true, error: null };
    } catch (e) {
      setAuthError(e.message || String(e));
      return { error: { message: e.message || String(e) } };
    }
  }

  /**
   * Build `options.data` for signUp — stored on `auth.users.raw_user_meta_data`.
   * DB trigger `handle_new_auth_user` reads `canteen_id` / `college_id` via `->>'canteen_id'` (text → UUID).
   * All values must be plain strings so JSON metadata round-trips reliably.
   */
  function buildAuthSignUpUserData(metadata = {}) {
    const out = {};
    const fn = metadata.full_name ?? metadata.fullName;
    if (fn != null && String(fn).trim() !== '') {
      out.full_name = String(fn).trim();
    }
    const cid = metadata.canteen_id ?? metadata.canteenId;
    if (cid != null && String(cid).trim() !== '') {
      out.canteen_id = String(cid).trim();
    }
    const colid = metadata.college_id ?? metadata.collegeId;
    if (colid != null && String(colid).trim() !== '') {
      out.college_id = String(colid).trim();
    }
    return out;
  }

  async function signUpWithPassword(email, password, metadata = {}) {
    setAuthError(null);
    try {
      const { data: signupSessionData, error: signupSessionErr } = await supabase.auth.getSession();
      // ✅ crash prevention added
      if (signupSessionErr) {
        console.error('signUp getSession:', signupSessionErr.message || signupSessionErr);
      }
      const priorSession = signupSessionData?.session ?? null;
      if (priorSession) {
        setAuthError(ALREADY_SIGNED_IN_MESSAGE);
        return {
          data: null,
          error: { message: ALREADY_SIGNED_IN_MESSAGE, code: ALREADY_SIGNED_IN_CODE },
          needsVerification: false,
        };
      }

      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (normalizedEmail) {
        const { data: alreadyExists, error: existsRpcError } = await supabase.rpc('check_auth_email_exists', {
          p_email: normalizedEmail,
        });
        if (!existsRpcError && rpcAuthEmailExistsResultIsTrue(alreadyExists)) {
          const dup = { message: ACCOUNT_EXISTS_MESSAGE, code: AUTH_EMAIL_DUPLICATE_CODE };
          setAuthError(ACCOUNT_EXISTS_MESSAGE);
          return { data: null, error: dup, needsVerification: false };
        }
        if (existsRpcError) {
          if (__DEV__) {
            console.warn('check_auth_email_exists failed (signup will still be attempted):', existsRpcError.message || existsRpcError);
          }
        }
      }

      const userData = buildAuthSignUpUserData(metadata);
      if (!userData.canteen_id) {
        console.warn(
          'signUp: no `canteen_id` in user metadata — trigger handle_new_auth_user cannot set public.users.canteen_id'
        );
      }
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: userData },
      });

      if (error) {
        if (__DEV__) {
          console.error('signUp auth error (Postgres trigger on auth.users often causes "database error"):', error);
        }
        setAuthError(error.message);
        return { data: null, error };
      }

      // Duplicate / anti-enumeration: no error, but no user and no session — not "check your email" for a new row
      if (!data?.user && !data?.session) {
        setAuthError(ACCOUNT_EXISTS_MESSAGE);
        return {
          data,
          error: { message: ACCOUNT_EXISTS_MESSAGE, code: AUTH_EMAIL_DUPLICATE_CODE },
          needsVerification: false,
        };
      }

      // If session exists, user is signed in immediately (no email confirmation)
      if (data?.user && data?.session) {
        const u = data.user;
        setUser(u);
        setUserId(u.id);
        setIsSignedIn(true);
        // Trigger should have filled `public.users`; optional client upsert (no full_name — not on public.users)
        try {
          const { error: upsertErr } = await supabase.from('users').upsert(
            {
              id: u.id,
              canteen_id: userData.canteen_id || null,
              college_id: userData.college_id || null,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          );
          if (upsertErr) {
            console.error('users.upsert:', upsertErr.message || upsertErr);
          }
        } catch (e) {
          console.error('Unexpected Error:', e);
        }
      } else if (data?.user) {
        // Email confirmation pending — no session; `handle_new_auth_user` must use signUp metadata
        setUser(data.user);
        setUserId(data.user.id);
        setIsSignedIn(false);
      }

      // Only true when we actually have a new user row waiting for email confirmation
      const needsVerification = Boolean(data?.user) && !data?.session;
      return { data, error: null, needsVerification };
    } catch (e) {
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  async function verifyEmailCode(code) {
    // Supabase email verification via code is not supported in the same way as Clerk.
    return { data: null, error: { message: 'Email code verification not supported. Use the confirmation link sent to email.' } };
  }

  async function resendVerification(email) {
    // Supabase doesn't provide a direct "resend verification" endpoint;
    // recommend using magic link or ask user to sign up again.
    return { data: null, error: { message: 'Resend verification not supported. Use magic link or check your email.' } };
  }

  async function resetPassword(email) {
    try {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('rate') || msg.includes('too many')) {
          return { success: false, error: 'Too many requests. Please wait a moment and try again.' };
        }
        if (msg.includes('not found') || msg.includes('no user') || msg.includes('invalid email')) {
          return { success: false, error: 'No account found with this email address.' };
        }
        return { success: false, error: 'Could not send the reset email. Please try again.' };
      }
      return { success: true, data, error: null };
    } catch (e) {
      return { success: false, error: 'Connection error. Please check your internet and try again.' };
    }
  }

  async function verifyResetPassword(email, code, newPassword) {
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const normalizedCode = String(code || '').trim();
      if (!normalizedEmail || !normalizedCode || !newPassword) {
        return { success: false, error: 'Email, reset code, and new password are required.' };
      }

      // 1) Verify recovery OTP code sent by Supabase auth email template
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: normalizedCode,
        type: 'recovery',
      });
      if (verifyError) {
        return { success: false, error: 'The reset code is invalid or has expired. Please request a new one.' };
      }

      // 2) Update password in the authenticated recovery session
      const { data, error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        return { success: false, error: 'Could not update your password. Please try again.' };
      }

      return { success: true, data, error: null };
    } catch (e) {
      return { success: false, error: 'Connection error. Please check your internet and try again.' };
    }
  }

  async function handleSignOut() {
    try {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('Signing out');
      }
      const { error } = await supabase.auth.signOut();
      if (error && typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('signOut API error:', error?.message || error);
      }
      // Always clear local state regardless of API result
      setUser(null);
      setUserId(null);
      setIsSignedIn(false);
      setProfile(null);
      setUserRole(null);
      setAuthError(null);
      return { data: true, error: null };
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('signOut exception:', e?.message || e);
      }
      // Force-clear state even on exception
      setUser(null);
      setUserId(null);
      setIsSignedIn(false);
      setProfile(null);
      setUserRole(null);
      setAuthError(null);
      return { data: null, error: e };
    }
  }

  const getSupabaseToken = async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error('getSession:', error.message || error);
        return null;
      }
      return data?.session?.access_token || null;
    } catch (e) {
      console.error('Unexpected Error:', e);
      return null;
    }
  };

  // Build the loading state
  const loading = !isLoaded || (isSignedIn && !authProfileReady);

  return (
    <AuthContext.Provider value={{
      user,
      userId,
      userRole,
      loading,
      authError,
      isLoaded,
      isSignedIn: !!isSignedIn,
      profile,
      loadingProfile,

      // Auth methods — backward compatible names
      signIn: signInWithPassword,
      signUp: signUpWithPassword,
      signOut: handleSignOut,
      resetPassword,
      verifyResetPassword,
      resendVerification,
      verifyEmailCode,
      setAuthError,

      // New Supabase-specific
      signInWithPassword,
      signInWithMagicLink,
      signUpWithPassword,
      getSupabaseToken,
      getAuthenticatedSupabase: () => supabase,
    }}>
      {children}
    </AuthContext.Provider>
  );
}