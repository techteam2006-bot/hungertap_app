/** Offline / transport failure during auth (login, OTP, password reset). */
export const AUTH_NETWORK_ERROR_CODE = 'network_error';
export const AUTH_NETWORK_ERROR_MESSAGE =
  'Connection error. Please check your internet and try again.';

/** Shown when the email is already registered (Supabase + common variants). */
export const ACCOUNT_EXISTS_TITLE = 'Account already exists';
export const ACCOUNT_EXISTS_MESSAGE = 'Email already exists!';
export const EMAIL_ALREADY_EXISTS_MESSAGE = 'Email already exists!';

/** Forgot / reset password when the email has no completed account. */
export const ACCOUNT_NOT_SIGNED_UP_CODE = 'ACCOUNT_NOT_SIGNED_UP';
export const ACCOUNT_NOT_SIGNED_UP_MESSAGE =
  'This email is not signed up. Please create an account first.';

/** Client/UI code when Auth reports the email is already registered. */
export const AUTH_EMAIL_DUPLICATE_CODE = 'AUTH_EMAIL_DUPLICATE';

/** Returned when a Supabase session already exists (rehydration / signed-in user hits Sign up). */
export const ALREADY_SIGNED_IN_CODE = 'ALREADY_SIGNED_IN';
export const ALREADY_SIGNED_IN_MESSAGE =
  'You are already signed in. Log out if you need to use a different account.';

/** Legacy synthetic message; still matches server/auth duplicate copy. */
export const AUTH_EMAIL_DUPLICATE_ERROR = Object.freeze({ message: 'User already registered' });

/**
 * Signup completion error kinds (password set after OTP).
 * Prefer Supabase `error.code` / `AuthWeakPasswordError.reasons` over message sniffing.
 *
 * @typedef {'invalid_password'|'password_rejected'|'session_missing'|'otp_invalid'|'auth_failed'|'profile_failed'|'network_error'|'unknown'} SignupErrorType
 */

/** @type {Record<SignupErrorType, string>} */
export const SIGNUP_ERROR_MESSAGES = Object.freeze({
  invalid_password: 'Please choose a stronger password that meets all requirements.',
  password_rejected:
    'This password is not secure enough or has appeared in a data breach. Please choose a different password.',
  session_missing: 'Your verification session has expired. Please verify your OTP again.',
  otp_invalid: 'The verification code is invalid or expired. Please request a new code.',
  auth_failed: 'We couldn’t create your account right now. Please try again.',
  profile_failed:
    'We could not create your account right now. Please try again or contact support if the issue continues.',
  network_error: 'We couldn’t complete account creation. Check your connection and try again.',
  unknown: 'We couldn’t create your account right now. Please try again.',
});

/**
 * True when sign-up failed because this email is already in use (wording varies by Supabase / provider).
 */
export function isAlreadySignedInError(error) {
  return error && error.code === ALREADY_SIGNED_IN_CODE;
}

export function isEmailAlreadyInUseError(error) {
  if (error && error.code === AUTH_EMAIL_DUPLICATE_CODE) return true;
  const m = (error && error.message) || String(error || '');
  const lower = m.toLowerCase();
  if (!lower) return false;
  if (lower.includes('account already exists with this mail')) return true;
  if (lower.includes('already registered') || lower.includes('already been registered')) return true;
  if (lower.includes('user_already_registered')) return true;
  if (lower.includes('user with this email') && lower.includes('already')) return true;
  if (lower.includes('user already registered') || lower.includes('email already exists')) return true;
  if (lower.includes('duplicate key') && lower.includes('email')) return true;
  if (error && String(error.code || '').toLowerCase() === 'user_already_registered') return true;
  return false;
}

/** @param {unknown} error */
function authErrorCode(error) {
  if (!error || typeof error !== 'object') return '';
  const e = /** @type {{ code?: string, error_code?: string }} */ (error);
  return String(e.code || e.error_code || '').toLowerCase();
}

/** @param {unknown} error */
function authErrorName(error) {
  if (!error || typeof error !== 'object') return '';
  return String(/** @type {{ name?: string }} */ (error).name || '');
}

/** @param {unknown} error */
function authErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(/** @type {{ message?: string }} */ (error).message || error || '');
}

/**
 * Supabase AuthWeakPasswordError exposes `reasons: ('length'|'characters'|'pwned')[]`.
 * Legacy/API payloads may nest reasons under `weak_password.reasons`.
 * @param {unknown} error
 * @returns {string[]}
 */
export function getWeakPasswordReasons(error) {
  if (!error || typeof error !== 'object') return [];
  const e = /** @type {{ reasons?: unknown, weak_password?: { reasons?: unknown } }} */ (error);
  const raw = Array.isArray(e.reasons)
    ? e.reasons
    : Array.isArray(e.weak_password?.reasons)
      ? e.weak_password.reasons
      : [];
  return raw.map((r) => String(r || '').toLowerCase()).filter(Boolean);
}

/**
 * Classify a signup / password-set Auth error using Supabase codes & typed errors first.
 * @param {unknown} error
 * @returns {SignupErrorType}
 */
export function classifySignupError(error) {
  if (!error) return 'unknown';

  const code = authErrorCode(error);
  const name = authErrorName(error);
  const lower = authErrorMessage(error).toLowerCase();
  const reasons = getWeakPasswordReasons(error);

  // Network / transport (AuthRetryableFetchError or local network_error).
  if (
    code === AUTH_NETWORK_ERROR_CODE ||
    name === 'AuthRetryableFetchError' ||
    lower.includes('failed to fetch') ||
    lower.includes('network request failed') ||
    (lower.includes('network') && lower.includes('error'))
  ) {
    return 'network_error';
  }

  // Session missing / expired after OTP (AuthSessionMissingError or GoTrue codes).
  if (
    code === 'session_missing' ||
    code === 'session_not_found' ||
    code === 'session_expired' ||
    name === 'AuthSessionMissingError' ||
    lower.includes('auth session missing') ||
    lower.includes('please verify your email with the otp')
  ) {
    return 'session_missing';
  }

  // Leaked / weak password — prefer code + reasons over message sniffing.
  // GoTrue: code "weak_password"; client: AuthWeakPasswordError with reasons incl. "pwned".
  if (code === 'weak_password' || name === 'AuthWeakPasswordError') {
    if (reasons.includes('pwned')) return 'password_rejected';
    if (reasons.includes('length') || reasons.includes('characters')) return 'invalid_password';
    // Empty reasons still often means HIBP / policy rejection on updateUser.
    return 'password_rejected';
  }

  // Message fallback only for known GoTrue HIBP copy (when code missing on older clients).
  if (
    lower.includes('password is known to be weak') ||
    lower.includes('easy to guess') ||
    (lower.includes('pwned') && lower.includes('password'))
  ) {
    return 'password_rejected';
  }

  if (
    code === 'otp_expired' ||
    code === 'otp_disabled' ||
    lower.includes('otp_expired') ||
    lower.includes('token has expired') ||
    (lower.includes('invalid') && (lower.includes('otp') || lower.includes('token')))
  ) {
    return 'otp_invalid';
  }

  if (
    lower.includes('database error saving new user') ||
    (code === 'unexpected_failure' && lower.includes('database'))
  ) {
    return 'profile_failed';
  }

  if (
    code === 'same_password' ||
    lower.includes('same password') ||
    lower.includes('should be different') ||
    lower.includes('different from the old')
  ) {
    // Password already applied earlier in the flow — treat as recoverable auth state, not rejection.
    return 'auth_failed';
  }

  if (name === 'AuthApiError' || code) {
    return 'auth_failed';
  }

  return 'unknown';
}

/**
 * Map a Supabase / signup error to a safe user-facing message.
 * @param {unknown} error
 * @returns {{ type: SignupErrorType, title: string, message: string }}
 */
export function mapSignupError(error) {
  if (isAlreadySignedInError(error)) {
    return { type: 'auth_failed', title: 'Already signed in', message: ALREADY_SIGNED_IN_MESSAGE };
  }
  if (isEmailAlreadyInUseError(error)) {
    return {
      type: 'auth_failed',
      title: ACCOUNT_EXISTS_TITLE,
      message: EMAIL_ALREADY_EXISTS_MESSAGE,
    };
  }

  const type = classifySignupError(error);
  const message = SIGNUP_ERROR_MESSAGES[type] || SIGNUP_ERROR_MESSAGES.unknown;

  /** @type {Record<SignupErrorType, string>} */
  const titles = {
    invalid_password: 'Weak password',
    password_rejected: 'Password rejected',
    session_missing: 'Session expired',
    otp_invalid: 'Invalid code',
    auth_failed: 'Sign Up Failed',
    profile_failed: 'Sign Up Failed',
    network_error: 'Connection error',
    unknown: 'Sign Up Failed',
  };

  // Same-password mid-flow: keep the clearer recovery copy.
  const lower = authErrorMessage(error).toLowerCase();
  if (
    type === 'auth_failed' &&
    (authErrorCode(error) === 'same_password' ||
      lower.includes('same password') ||
      lower.includes('should be different') ||
      lower.includes('different from the old'))
  ) {
    return {
      type: 'auth_failed',
      title: 'Almost done',
      message:
        'Your password is already set. Tap Sign Up again to finish linking your canteen, or log in.',
    };
  }

  return { type, title: titles[type] || 'Sign Up Failed', message };
}

/**
 * Friendly copy for email OTP send / verify failures.
 * @returns {{ title: string, message: string }}
 */
export function describeOtpFailure(error, { context = 'verify' } = {}) {
  const m = (error && error.message) || String(error || '');
  const lower = m.toLowerCase();

  if (isEmailAlreadyInUseError(error)) {
    return { title: ACCOUNT_EXISTS_TITLE, message: EMAIL_ALREADY_EXISTS_MESSAGE };
  }

  if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch')) {
    if (context === 'send') {
      return {
        title: 'Could not send code',
        message:
          'Could not reach the verification service. Please try again in a moment.',
      };
    }
    return {
      title: 'Connection error',
      message: 'Please check your internet connection and try again.',
    };
  }

  if (lower.includes('rate') || lower.includes('too many') || lower.includes('over_email_send_rate')) {
    return {
      title: 'Too many attempts',
      message: 'Please wait a moment before requesting or entering another code.',
    };
  }

  if (context === 'send') {
    if (lower.includes('canteen')) {
      return { title: 'Canteen not found', message: m };
    }
    if (lower.includes('not found') || lower.includes('no user') || lower.includes('user not found')) {
      return {
        title: 'Email not registered',
        message: 'No account found with this email. Check the address or sign up first.',
      };
    }
    if (
      lower.includes('error sending confirmation') ||
      lower.includes('error sending magic link') ||
      lower.includes('unexpected_failure')
    ) {
      console.error('[describeOtpFailure] Auth mailer failure (send):', m);
      return {
        title: 'Could not send code',
        message:
          'We could not send a verification code right now. Please try again in a moment.',
      };
    }
    console.error('[describeOtpFailure] OTP send failure:', m);
    return {
      title: 'Could not send code',
      message: 'We could not send a verification code. Please try again.',
    };
  }

  if (
    lower.includes('expired') ||
    lower.includes('otp_expired') ||
    lower.includes('token has expired')
  ) {
    return {
      title: 'Code expired',
      message: 'That code has expired. Tap Resend Code to get a new one.',
    };
  }

  if (
    lower.includes('invalid') ||
    lower.includes('otp') ||
    lower.includes('token') ||
    lower.includes('credentials')
  ) {
    return {
      title: 'Invalid code',
      message: 'The code you entered is incorrect. Please try again.',
    };
  }

  return {
    title: 'Verification failed',
    message: 'Something went wrong. Please try again.',
  };
}

/**
 * Maps Supabase Auth errors to clearer copy during sign-up completion.
 * @returns {{ type?: SignupErrorType, title: string, message: string }}
 */
export function describeSignUpFailure(error) {
  return mapSignupError(error);
}
