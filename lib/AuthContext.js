import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import {
  ACCOUNT_EXISTS_MESSAGE,
  ALREADY_SIGNED_IN_CODE,
  ALREADY_SIGNED_IN_MESSAGE,
  AUTH_EMAIL_DUPLICATE_CODE,
  isEmailAlreadyInUseError,
} from './authErrorMessages';

const PENDING_SIGNUP_KEY = 'hungertap_pending_signup_v1';

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
  /** True while signup OTP is in progress — avoid GlobalLoading remount wiping the Sign Up form. */
  const [pendingSignupCompletion, setPendingSignupCompletion] = useState(false);
  const [pendingSignupMetadata, setPendingSignupMetadata] = useState({});
  const pendingSignupRef = React.useRef(false);
  const pendingSignupMetaRef = React.useRef({});
  /** True while recovery OTP is verified but new password not set yet — stay on Forgot Password. */
  const [pendingPasswordReset, setPendingPasswordReset] = useState(false);
  const pendingPasswordResetRef = React.useRef(false);

  const beginPendingSignup = (metadata = {}) => {
    const meta = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    pendingSignupRef.current = true;
    pendingSignupMetaRef.current = meta;
    setPendingSignupMetadata(meta);
    setPendingSignupCompletion(true);
    AsyncStorage.setItem(
      PENDING_SIGNUP_KEY,
      JSON.stringify({ metadata: meta, at: Date.now() })
    ).catch(() => {});
  };

  const clearPendingSignup = () => {
    pendingSignupRef.current = false;
    pendingSignupMetaRef.current = {};
    setPendingSignupMetadata({});
    setPendingSignupCompletion(false);
    AsyncStorage.removeItem(PENDING_SIGNUP_KEY).catch(() => {});
  };

  const beginPendingPasswordReset = () => {
    pendingPasswordResetRef.current = true;
    setPendingPasswordReset(true);
  };

  const clearPendingPasswordReset = () => {
    pendingPasswordResetRef.current = false;
    setPendingPasswordReset(false);
  };

  // Initialize auth state
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        try {
          const raw = await AsyncStorage.getItem(PENDING_SIGNUP_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            pendingSignupRef.current = true;
            pendingSignupMetaRef.current =
              parsed?.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {};
            setPendingSignupMetadata(pendingSignupMetaRef.current);
            setPendingSignupCompletion(true);
          }
        } catch (_) {}

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
          if (pendingSignupRef.current) {
            // Mid-signup: do not block UI on profile sync
            setAuthProfileReady(true);
          } else {
            setAuthProfileReady(false);
            await syncProfileAndRole(u?.id);
            setAuthProfileReady(true);
          }
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

          // Mid-signup / password-reset OTP: keep guest auth UI mounted.
          if (pendingSignupRef.current || pendingPasswordResetRef.current) {
            setAuthProfileReady(true);
            return;
          }

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
          clearPendingSignup();
          clearPendingPasswordReset();
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
            // Do not auto-create profile on login / session restore.
            // Profile RPC runs only during signup (OTP / completeSignup).
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
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const normalizedPassword = String(password || '');
      if (!normalizedEmail || !normalizedPassword) {
        const err = { message: 'Email and password are required.', code: 'validation_failed' };
        setAuthError(err.message);
        return { data: null, error: err };
      }

      // Orphan OTP signup leaves a session with no password. Clear it so password
      // login is not blocked / confused by the existing session.
      try {
        const { data: existing } = await supabase.auth.getSession();
        if (existing?.session) {
          await supabase.auth.signOut({ scope: 'local' });
        }
      } catch (_) {}

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: normalizedPassword,
      });
      if (error) {
        const msg = error.message || 'Invalid login credentials';
        const enriched = { ...error, message: msg };
        setAuthError(enriched.message);
        return { data: null, error: enriched };
      }
      // Profile is created at signup only — not on password login.
      return { data, error: null };
    } catch (e) {
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  /**
   * Persist password on the current OTP session before canteen / profile steps.
   * OTP signup creates auth.users without a password — if later steps fail, login
   * would otherwise reject the password the user already typed.
   */
  async function setPasswordForPendingSignup(password) {
    setAuthError(null);
    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        console.error('setPasswordForPendingSignup getSession:', sessionErr.message || sessionErr);
      }
      const session = sessionData?.session;
      if (!session?.user) {
        const err = {
          message: 'Please verify your email with the OTP before creating your account.',
        };
        setAuthError(err.message);
        return { data: null, error: err };
      }
      const pw = String(password || '');
      if (pw.length < 8) {
        const err = { message: 'Password must be at least 8 characters.' };
        setAuthError(err.message);
        return { data: null, error: err };
      }
      const { data, error } = await supabase.auth.updateUser({ password: pw });
      if (error) {
        setAuthError(error.message);
        return { data: null, error };
      }
      if (data?.user) setUser(data.user);
      return { data, error: null };
    } catch (e) {
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  /** Send a 6-digit email OTP (passwordless). Alias kept as `signInWithMagicLink` for older callers. */
  async function sendEmailOtp(email, options = {}) {
    setAuthError(null);
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const shouldCreateUser = options.shouldCreateUser !== false;
      const userData =
        options.data && typeof options.data === 'object' ? options.data : undefined;
      const { data, error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser,
          ...(userData && Object.keys(userData).length ? { data: userData } : {}),
        },
      });
      if (error) {
        setAuthError(error.message);
        return { data: null, error };
      }
      return { data, pending: true, error: null };
    } catch (e) {
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  /**
   * Signup OTP — no email-exists pre-check (avoids extra mails / enumeration).
   * Auth returns user_already_registered when appropriate; incomplete signups can still get OTP.
   * @param {string} email
   * @param {{ full_name?: string, fullName?: string }} [metadata] — stored on auth.users user_metadata
   */
  async function sendSignupEmailOtp(email, metadata = {}) {
    setAuthError(null);
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        const err = { message: 'Email is required.' };
        setAuthError(err.message);
        return { data: null, error: err };
      }

      const userData = buildAuthSignUpUserData(metadata);
      beginPendingSignup(metadata);

      // Prefer create; if Auth says already registered, retry as resume (OTP only, no new user).
      let result = await sendEmailOtp(normalizedEmail, {
        shouldCreateUser: true,
        data: userData,
      });
      if (result.error && isEmailAlreadyInUseError(result.error)) {
        result = await sendEmailOtp(normalizedEmail, {
          shouldCreateUser: false,
          data: userData,
        });
        if (result.error) {
          clearPendingSignup();
          return result;
        }
        return { ...result, resumed: true };
      }
      if (result.error) {
        clearPendingSignup();
      }
      return result;
    } catch (e) {
      clearPendingSignup();
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  async function signInWithMagicLink(email) {
    return sendEmailOtp(email);
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
      const name = String(fn).trim();
      // auth.users.raw_user_meta_data — dashboards often look for either key
      out.full_name = name;
      out.name = name;
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
        if (isEmailAlreadyInUseError(error)) {
          const dup = { ...error, message: ACCOUNT_EXISTS_MESSAGE, code: AUTH_EMAIL_DUPLICATE_CODE };
          setAuthError(ACCOUNT_EXISTS_MESSAGE);
          return { data: null, error: dup, needsVerification: false };
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

  /**
   * Verify the 6-digit email OTP from `sendEmailOtp` / `signInWithOtp`.
   * @param {string} email
   * @param {string} code
   * @param {{ deferProfile?: boolean }} [options] — signup OTP: defer profile sync / stay on Sign Up
   */
  async function verifyEmailCode(email, code, options = {}) {
    setAuthError(null);
    const deferProfile = Boolean(options.deferProfile) || pendingSignupRef.current;
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const token = String(code || '').trim();
      if (!normalizedEmail || !token) {
        const err = { message: 'Email and verification code are required.' };
        setAuthError(err.message);
        return { data: null, error: err };
      }

      if (deferProfile) {
        beginPendingSignup({
          ...pendingSignupMetaRef.current,
          ...(options.metadata || {}),
        });
      }

      const { data, error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token,
        type: 'email',
      });

      if (error) {
        setAuthError(error.message);
        return { data: null, error };
      }

      if (data?.session?.user) {
        const u = data.session.user;
        if (deferProfile) {
          // Persist full_name (and other signup meta) on auth.users immediately after OTP.
          const meta = buildAuthSignUpUserData({
            ...pendingSignupMetaRef.current,
            ...(options.metadata || {}),
          });
          if (Object.keys(meta).length) {
            const { data: updated, error: metaErr } = await supabase.auth.updateUser({ data: meta });
            if (metaErr) {
              console.warn('verifyEmailCode updateUser metadata:', metaErr.message || metaErr);
            } else if (updated?.user) {
              setUser(updated.user);
            }
          }
        } else {
          await invokeCreateUserProfileFromAuth(u.id);
        }
      }

      return { data, error: null };
    } catch (e) {
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  async function resendVerification(email) {
    return sendEmailOtp(email);
  }

  /**
   * True when Auth rejects re-setting the same password (already applied earlier).
   */
  function isSamePasswordUpdateError(error) {
    const m = String(error?.message || error || '').toLowerCase();
    if (!m) return false;
    return (
      m.includes('same password') ||
      m.includes('should be different') ||
      m.includes('different from the old') ||
      m.includes('password is unchanged') ||
      error?.code === 'same_password'
    );
  }

  /**
   * After signup email OTP is verified (session exists), set password + canteen metadata once.
   * Do not call `signUp` again — the auth user already exists from OTP.
   */
  async function completeSignupAfterEmailOtp(password, metadata = {}) {
    setAuthError(null);
    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        console.error('completeSignup getSession:', sessionErr.message || sessionErr);
      }
      const session = sessionData?.session;
      if (!session?.user) {
        const err = { message: 'Please verify your email with the OTP before creating your account.' };
        setAuthError(err.message);
        return { data: null, error: err };
      }

      const userData = buildAuthSignUpUserData({
        ...pendingSignupMetaRef.current,
        ...metadata,
      });
      const pw = String(password || '');

      // Single Auth update: password + metadata. If password was already set, retry metadata-only.
      let data = null;
      let updateError = null;
      {
        const result = await supabase.auth.updateUser({
          ...(pw ? { password: pw } : {}),
          data: userData,
        });
        data = result.data;
        updateError = result.error;
      }
      if (updateError && pw && isSamePasswordUpdateError(updateError)) {
        const retry = await supabase.auth.updateUser({ data: userData });
        data = retry.data;
        updateError = retry.error;
      }
      if (updateError) {
        setAuthError(updateError.message);
        return { data: null, error: updateError };
      }

      const u = data?.user || session.user;

      // Profile write is best-effort — Auth account already exists. Never fail signup if this soft-fails.
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

      clearPendingSignup();
      try {
        await invokeCreateUserProfileFromAuth(u.id);
      } catch (e) {
        console.error('create_user_profile_from_auth:', e);
      }

      setUser(u);
      setUserId(u.id);
      setIsSignedIn(true);
      setAuthProfileReady(false);
      try {
        await syncProfileAndRole(u.id);
      } catch (e) {
        console.error('completeSignup syncProfile:', e);
      }
      setAuthProfileReady(true);

      return { data, error: null };
    } catch (e) {
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
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

  async function verifyResetOtp(email, code) {
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const normalizedCode = String(code || '').trim();
      if (!normalizedEmail || !normalizedCode) {
        return { success: false, error: 'Email and reset code are required.' };
      }

      beginPendingPasswordReset();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: normalizedCode,
        type: 'recovery',
      });
      if (verifyError) {
        clearPendingPasswordReset();
        return {
          success: false,
          error: 'The reset code is invalid or has expired. Please request a new one.',
        };
      }

      return { success: true, error: null };
    } catch (e) {
      clearPendingPasswordReset();
      return { success: false, error: 'Connection error. Please check your internet and try again.' };
    }
  }

  async function completePasswordReset(newPassword) {
    try {
      if (!newPassword) {
        return { success: false, error: 'New password is required.' };
      }

      const { data, error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        return { success: false, error: 'Could not update your password. Please try again.' };
      }

      clearPendingPasswordReset();
      try {
        await supabase.auth.signOut();
      } catch (_) {}

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

      const verified = await verifyResetOtp(normalizedEmail, normalizedCode);
      if (!verified.success) return verified;

      return completePasswordReset(newPassword);
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

  // Build the loading state — skip gate while finishing signup after OTP (keeps Sign Up mounted)
  const loading =
    !isLoaded ||
    (isSignedIn && !authProfileReady && !pendingSignupCompletion && !pendingPasswordReset);

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
      pendingSignupCompletion,
      pendingSignupMetadata,
      pendingPasswordReset,

      // Auth methods — backward compatible names
      signIn: signInWithPassword,
      signUp: signUpWithPassword,
      signOut: handleSignOut,
      resetPassword,
      verifyResetOtp,
      completePasswordReset,
      verifyResetPassword,
      resendVerification,
      verifyEmailCode,
      setAuthError,
      beginPendingSignup,
      clearPendingSignup,
      beginPendingPasswordReset,
      clearPendingPasswordReset,

      // New Supabase-specific
      signInWithPassword,
      sendEmailOtp,
      sendSignupEmailOtp,
      setPasswordForPendingSignup,
      completeSignupAfterEmailOtp,
      signInWithMagicLink,
      signUpWithPassword,
      getSupabaseToken,
      getAuthenticatedSupabase: () => supabase,
    }}>
      {children}
    </AuthContext.Provider>
  );
}