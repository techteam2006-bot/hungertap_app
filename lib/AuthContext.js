import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import {
  ACCOUNT_EXISTS_MESSAGE,
  ACCOUNT_NOT_SIGNED_UP_CODE,
  ACCOUNT_NOT_SIGNED_UP_MESSAGE,
  ALREADY_SIGNED_IN_CODE,
  ALREADY_SIGNED_IN_MESSAGE,
  AUTH_EMAIL_DUPLICATE_CODE,
  AUTH_NETWORK_ERROR_CODE,
  AUTH_NETWORK_ERROR_MESSAGE,
  isEmailAlreadyInUseError,
} from './authErrorMessages';
import { isNetworkConnectivityFailure } from './orderFlowErrors';
import { getCachedProfile, setCachedProfile, clearCachedProfile, clearCachedCanteenStatus } from './settingsCache';
import { disablePushOnSignOut } from './services/notifications';
import { savePhoneToUserMetadata } from './userPhone';

/** Normalize thrown/returned auth failures into a stable, user-safe error object. */
function toAuthError(error, fallbackMessage = 'Something went wrong. Please try again.') {
  if (isNetworkConnectivityFailure(error)) {
    return { message: AUTH_NETWORK_ERROR_MESSAGE, code: AUTH_NETWORK_ERROR_CODE };
  }
  if (error && typeof error === 'object') {
    const message =
      (typeof error.message === 'string' && error.message.trim()) || fallbackMessage;
    return { ...error, message, code: error.code || undefined };
  }
  const message =
    typeof error === 'string' && error.trim() ? error.trim() : fallbackMessage;
  return { message };
}

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
          // Validate with server — local session survives auth.users deletion.
          const { data: userData, error: userError } = await supabase.auth.getUser();
          if (userError || !userData?.user) {
            await supabase.auth.signOut({ scope: 'local' });
            if (mounted) setAuthProfileReady(true);
            return;
          }
          const u = userData.user;
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

          // Password-reset OTP: keep guest auth UI mounted; never create a profile here.
          if (pendingPasswordResetRef.current) {
            setAuthProfileReady(true);
            return;
          }

          // Mid-signup: after email OTP verify, create public.users once (verified + session).
          if (pendingSignupRef.current) {
            if (isEmailVerified(u)) {
              await ensureUserProfileAfterEmailVerified(u);
            }
            setAuthProfileReady(true);
            return;
          }

          setAuthProfileReady(false);
          await syncProfileAndRole(u?.id);
          setAuthProfileReady(true);
        } else if (event === 'SIGNED_OUT') {
          setUser((prev) => {
            const uid = prev?.id;
            if (uid) {
              clearCachedProfile(uid).catch(() => {});
              clearCachedCanteenStatus(uid).catch(() => {});
            }
            return null;
          });
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

  /** True when Auth reports the email as confirmed (OTP / link verify succeeded). */
  function isEmailVerified(authUser) {
    if (!authUser) return false;
    return Boolean(authUser.email_confirmed_at || authUser.confirmed_at);
  }

  /**
   * Creates `public.users` only after email verification + a valid session.
   * Single idempotent path via RPC (ON CONFLICT); never inserts for unverified users.
   */
  async function ensureUserProfileAfterEmailVerified(authUser) {
    if (!authUser?.id) return { ok: false, reason: 'no_user' };
    if (!isEmailVerified(authUser)) return { ok: false, reason: 'unverified' };

    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        console.error('ensureUserProfile getSession:', sessionErr.message || sessionErr);
      }
      const session = sessionData?.session;
      if (!session?.user?.id || session.user.id !== authUser.id) {
        return { ok: false, reason: 'no_session' };
      }

      await invokeCreateUserProfileFromAuth(authUser.id);
      return { ok: true };
    } catch (err) {
      console.error('ensureUserProfileAfterEmailVerified:', err);
      return { ok: false, reason: 'error' };
    }
  }

  /**
   * Ensures `public.users` for a verified authenticated account.
   * Requires Postgres function `create_user_profile_from_auth(p_user_id uuid)` for `authenticated`.
   * DB refuses unverified emails; ON CONFLICT prevents duplicate rows.
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
    // Offline / hung networks: fail open quickly so Home can use cached menu.
    const PROFILE_SYNC_TIMEOUT_MS = 8000;

    const applyProfile = async (data) => {
      if (!data) {
        setProfile(null);
        setUserRole(null);
        return;
      }
      setProfile(data);
      const role = data.role || null;
      setUserRole(role);
      if (role && role !== 'student') {
        await handleSignOut();
        setAuthError('Access denied. This app is only for students.');
      }
    };

    // Soft hydrate from AsyncStorage while network sync runs — required for offline home.
    let hadCache = false;
    try {
      const cached = await getCachedProfile(id);
      if (cached) {
        hadCache = true;
        await applyProfile(cached);
      }
    } catch (_) {}

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
            if (isNetworkConnectivityFailure(error) || hadCache) {
              const cached = await getCachedProfile(id);
              if (cached) {
                await applyProfile(cached);
                return;
              }
            }
            // Keep whatever we already hydrated from cache; do not wipe session offline.
            if (!hadCache) {
              setProfile(null);
              setUserRole(null);
            }
          } else if (data) {
            await applyProfile(data);
            setCachedProfile(id, data).catch(() => {});
          } else if (!hadCache) {
            // No public.users row — deleted account or incomplete signup.
            setProfile(null);
            setUserRole(null);
            if (!pendingSignupRef.current) {
              await handleSignOut();
            }
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
        console.warn('Profile sync timed out; continuing with cached profile if any.');
        try {
          const cached = await getCachedProfile(id);
          if (cached) await applyProfile(cached);
          else if (!hadCache) {
            setProfile(null);
            setUserRole(null);
          }
        } catch (_) {
          if (!hadCache) {
            setProfile(null);
            setUserRole(null);
          }
        }
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
        const enriched = toAuthError(error, 'Invalid login credentials');
        setAuthError(enriched.message);
        return { data: null, error: enriched };
      }
      // Profile is created at signup only — not on password login.
      return { data, error: null };
    } catch (e) {
      // Never surface raw TypeError / fetch failures to UI or LogBox.
      const enriched = toAuthError(e);
      setAuthError(enriched.message);
      return { data: null, error: enriched };
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
      console.log('[sendEmailOtp] request', {
        email: normalizedEmail,
        shouldCreateUser,
        metadataKeys: userData ? Object.keys(userData) : [],
      });
      const { data, error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser,
          ...(userData && Object.keys(userData).length ? { data: userData } : {}),
        },
      });
      if (error) {
        console.error('[sendEmailOtp] Supabase error:', {
          message: error.message,
          status: error.status,
          code: error.code,
        });
        setAuthError(error.message);
        return { data: null, error };
      }
      console.log('[sendEmailOtp] ok');
      return { data, pending: true, error: null };
    } catch (e) {
      console.error('[sendEmailOtp] unexpected:', e?.message || e);
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  /**
   * Signup OTP — native `signInWithOtp` (email template / 6-digit code).
   * Flow: name + canteen + email → Send OTP → verify → then set password.
   * Auth user is created as unconfirmed when the code is sent; password is set only after verify.
   */
  async function sendSignupEmailOtp(email, metadata = {}) {
    setAuthError(null);
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      console.log('[sendSignupEmailOtp] request received', { email: normalizedEmail });
      if (!normalizedEmail) {
        const err = { message: 'Email is required.' };
        setAuthError(err.message);
        return { data: null, error: err };
      }

      // Block emails that already have a finished profile (public.users).
      try {
        const { data: alreadyRegistered, error: existsErr } = await supabase.rpc(
          'email_already_registered',
          { p_email: normalizedEmail }
        );
        if (existsErr) {
          console.warn('email_already_registered RPC:', existsErr.message || existsErr);
        } else if (alreadyRegistered === true) {
          const err = {
            message: 'Email already exists!',
            code: AUTH_EMAIL_DUPLICATE_CODE,
          };
          setAuthError(err.message);
          return { data: null, error: err };
        }
      } catch (rpcErr) {
        console.warn('email_already_registered RPC unexpected:', rpcErr?.message || rpcErr);
      }

      const userData = buildAuthSignUpUserData(metadata);
      beginPendingSignup(metadata);

      const result = await sendEmailOtp(normalizedEmail, {
        shouldCreateUser: true,
        data: userData,
      });
      if (result.error && isEmailAlreadyInUseError(result.error)) {
        clearPendingSignup();
        const err = {
          ...result.error,
          message: 'Email already exists!',
          code: AUTH_EMAIL_DUPLICATE_CODE,
        };
        setAuthError(err.message);
        return { data: null, error: err };
      }
      if (result.error) {
        console.error('[sendSignupEmailOtp] failed:', {
          message: result.error.message,
          code: result.error.code,
          status: result.error.status,
        });
        clearPendingSignup();
        setAuthError(result.error.message);
        return result;
      }
      console.log('[sendSignupEmailOtp] ok (email OTP)');
      return result;
    } catch (e) {
      console.error('[sendSignupEmailOtp] unexpected:', e?.message || e);
      clearPendingSignup();
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  async function signInWithMagicLink(email) {
    return sendEmailOtp(email);
  }

  /**
   * Build `options.data` for signUp / OTP — stored on `auth.users.raw_user_meta_data`.
   * Profile RPC reads `canteen_id` / `college_id` after email verification.
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
          'signUp: no `canteen_id` in user metadata — profile canteen_id will be empty until set after verify'
        );
      }
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: userData },
      });

      if (error) {
        if (__DEV__) {
          console.error('signUp auth error:', error);
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

      // Never insert public.users until email is verified + session exists.
      if (data?.user && data?.session) {
        const u = data.user;
        setUser(u);
        setUserId(u.id);
        setIsSignedIn(true);
        if (isEmailVerified(u)) {
          await ensureUserProfileAfterEmailVerified(u);
        }
      } else if (data?.user) {
        // Email confirmation pending — auth.users only; no public.users row yet
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
   * On success (verified email + session), creates `public.users` once via RPC.
   * Password fields unlock only after this succeeds (see SignupForm).
   * @param {string} email
   * @param {string} code
   * @param {{ deferProfile?: boolean }} [options] — signup OTP: stay on Sign Up UI (profile still created)
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

      console.log('[verifyEmailCode] verifying', { email: normalizedEmail, type: 'email' });
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
        let u = data.session.user;
        setUser(u);
        setUserId(u.id);
        setIsSignedIn(true);

        // Persist signup meta on auth.users before profile creation so canteen_id is available.
        if (deferProfile || pendingSignupRef.current) {
          const meta = buildAuthSignUpUserData({
            ...pendingSignupMetaRef.current,
            ...(options.metadata || {}),
          });
          if (Object.keys(meta).length) {
            const { data: updated, error: metaErr } = await supabase.auth.updateUser({ data: meta });
            if (metaErr) {
              console.warn('verifyEmailCode updateUser metadata:', metaErr.message || metaErr);
            } else if (updated?.user) {
              u = updated.user;
              setUser(u);
            }
          }
        }

        // public.users only after successful email verification + authenticated session.
        if (!pendingPasswordResetRef.current) {
          await ensureUserProfileAfterEmailVerified(u);
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

      // Profile was created at email verification. Refresh canteen/college on the existing row only
      // (UPDATE — never insert here). Idempotent RPC as a safety net if verify missed it.
      try {
        if (userData.canteen_id) {
          const { error: updErr } = await supabase
            .from('users')
            .update({
              canteen_id: userData.canteen_id,
              college_id: userData.college_id || null,
            })
            .eq('id', u.id);
          if (updErr) {
            console.error('users.update after signup:', updErr.message || updErr);
          }
        }
        if (isEmailVerified(u) && session?.user) {
          await ensureUserProfileAfterEmailVerified(u);
        }
      } catch (e) {
        console.error('completeSignup profile refresh:', e);
      }

      // Sign out first while pendingSignupCompletion is still true so App stays on Login
      // (avoids a flash of Home / canteen-closed after account creation).
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (e) {
        console.error('completeSignup signOut:', e);
      }
      clearPendingSignup();
      setUser(null);
      setUserId(null);
      setUserRole(null);
      setIsSignedIn(false);
      setAuthProfileReady(true);

      return { data, error: null };
    } catch (e) {
      setAuthError(e.message || String(e));
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  async function resetPassword(email) {
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return { success: false, error: 'Please enter your email address.' };
      }

      // Supabase does not reveal missing users on resetPasswordForEmail — check first.
      try {
        const { data: registered, error: existsErr } = await supabase.rpc(
          'email_already_registered',
          { p_email: normalizedEmail }
        );
        if (existsErr) {
          console.warn('email_already_registered RPC (reset):', existsErr.message || existsErr);
        } else if (registered !== true) {
          return {
            success: false,
            error: ACCOUNT_NOT_SIGNED_UP_MESSAGE,
            code: ACCOUNT_NOT_SIGNED_UP_CODE,
          };
        }
      } catch (rpcErr) {
        console.warn('email_already_registered RPC unexpected (reset):', rpcErr?.message || rpcErr);
      }

      const { data, error } = await supabase.auth.resetPasswordForEmail(normalizedEmail);
      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('rate') || msg.includes('too many')) {
          return { success: false, error: 'Too many requests. Please wait a moment and try again.' };
        }
        if (msg.includes('not found') || msg.includes('no user') || msg.includes('invalid email')) {
          return {
            success: false,
            error: ACCOUNT_NOT_SIGNED_UP_MESSAGE,
            code: ACCOUNT_NOT_SIGNED_UP_CODE,
          };
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
        if (isSamePasswordUpdateError(updateError)) {
          return {
            success: false,
            error: 'Your new password must be different from your previous password.',
          };
        }
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
    const previousUserId = userId ?? user?.id ?? null;
    try {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('Signing out');
      }
      // Disable this device's FCM row + local notif pref before session ends (other devices keep tokens).
      if (previousUserId) {
        await disablePushOnSignOut(previousUserId).catch(() => {});
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
      if (previousUserId) {
        clearCachedProfile(previousUserId).catch(() => {});
        clearCachedCanteenStatus(previousUserId).catch(() => {});
      }
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
      if (previousUserId) {
        clearCachedProfile(previousUserId).catch(() => {});
        clearCachedCanteenStatus(previousUserId).catch(() => {});
      }
      return { data: null, error: e };
    }
  }

  const getSupabaseToken = async () => {
    try {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshed?.session?.access_token) {
        return refreshed.session.access_token;
      }
      const refreshMsg = String(refreshError?.message || '').toLowerCase();
      if (refreshMsg.includes('refresh token')) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        return null;
      }
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (__DEV__) console.warn('getSession:', error.message || error);
        return null;
      }
      return data?.session?.access_token || null;
    } catch (e) {
      if (__DEV__) console.warn('getSupabaseToken:', e?.message || e);
      return null;
    }
  };

  /**
   * Save checkout phone on auth user_metadata (client-only; edge reads it later).
   * @param {string} rawPhone
   */
  async function updateUserPhone(rawPhone) {
    const result = await savePhoneToUserMetadata(supabase, rawPhone);
    if (result.ok && result.user) {
      setUser(result.user);
    }
    return result;
  }

  /**
   * Soft-delete the signed-in student account after password re-check.
   * Blocks when active kitchen/payment orders exist (client + server).
   */
  async function softDeleteOwnAccount(password) {
    setAuthError(null);
    try {
      const email = String(user?.email || '').trim().toLowerCase();
      const normalizedPassword = String(password || '');
      if (!email || !normalizedPassword) {
        const err = { message: 'Password is required to delete your account.', code: 'validation_failed' };
        setAuthError(err.message);
        return { data: null, error: err };
      }

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: normalizedPassword,
      });
      if (reauthError) {
        const enriched = toAuthError(reauthError, 'Incorrect password. Please try again.');
        setAuthError(enriched.message);
        return { data: null, error: enriched };
      }

      // Client-side guard so the user always sees a clear warning even if RPC
      // JSON shape differs or PostgREST wraps the payload unexpectedly.
      try {
        const uid = user?.id;
        if (uid) {
          const { count, error: activeErr } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('placed_by', uid)
            .in('status', ['pending_payment', 'preparing', 'partially_ready', 'ready']);
          if (!activeErr && Number(count) > 0) {
            const message =
              'You have active orders in progress. Complete or wait for them before deleting your account.';
            setAuthError(message);
            return { data: null, error: { message, code: 'active_orders', count } };
          }
        }
      } catch (_) {}

      const { data: rawData, error } = await supabase.rpc('soft_delete_own_account');
      if (error) {
        const msg = String(error.message || '');
        if (/active_orders/i.test(msg)) {
          const message =
            'You have active orders in progress. Complete or wait for them before deleting your account.';
          setAuthError(message);
          return { data: null, error: { message, code: 'active_orders' } };
        }
        const enriched = toAuthError(error, 'Could not delete account. Please try again.');
        setAuthError(enriched.message);
        return { data: null, error: enriched };
      }

      let data = rawData;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (_) {}
      }

      if (!data?.success) {
        let message = 'Could not delete account. Please try again.';
        if (data?.error === 'active_orders') {
          message =
            'You have active orders in progress. Complete or wait for them before deleting your account.';
        } else if (data?.error === 'already_deleted') {
          message = 'This account is already scheduled for deletion.';
        } else if (data?.error === 'not_authorized') {
          message = 'Only student accounts can be deleted from this app.';
        }
        const err = { message, code: data?.error || 'soft_delete_failed' };
        setAuthError(message);
        return { data: null, error: err };
      }

      try {
        if (user?.id) await clearCachedProfile(user.id);
      } catch (_) {}

      await handleSignOut();
      return { data, error: null };
    } catch (e) {
      const enriched = toAuthError(e, 'Could not delete account. Please try again.');
      setAuthError(enriched.message);
      return { data: null, error: enriched };
    }
  }

  /** Restore a soft-deleted student account within the 7-day grace window. */
  async function restoreOwnAccount() {
    setAuthError(null);
    try {
      const { data, error } = await supabase.rpc('restore_own_account');
      if (error) {
        const enriched = toAuthError(error, 'Could not restore account. Please try again.');
        setAuthError(enriched.message);
        return { data: null, error: enriched };
      }
      if (!data?.success) {
        let message = 'Could not restore account. Please try again.';
        if (data?.error === 'grace_expired') {
          message = 'The 7-day restore window has ended. Please sign up again with this email.';
        } else if (data?.error === 'not_deleted') {
          message = 'This account is not scheduled for deletion.';
        }
        const err = { message, code: data?.error || 'restore_failed' };
        setAuthError(message);
        return { data: null, error: err };
      }

      setAuthProfileReady(false);
      await syncProfileAndRole(userId || user?.id);
      setAuthProfileReady(true);
      return { data, error: null };
    } catch (e) {
      const enriched = toAuthError(e, 'Could not restore account. Please try again.');
      setAuthError(enriched.message);
      return { data: null, error: enriched };
    }
  }

  const accountPendingDeletion = !!(
    isSignedIn &&
    profile?.is_deleted === true &&
    (profile?.role === 'student' || userRole === 'student')
  );

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
      accountPendingDeletion,

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
      softDeleteOwnAccount,
      restoreOwnAccount,

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
      updateUserPhone,
    }}>
      {children}
    </AuthContext.Provider>
  );
}