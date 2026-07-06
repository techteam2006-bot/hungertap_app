/** Shown when the email is already registered (Supabase + common variants). */
export const ACCOUNT_EXISTS_TITLE = 'Account already exists';
export const ACCOUNT_EXISTS_MESSAGE =
  'An account already exists with this mail address. Please sign in instead.';

/** Returned from `signUp` when `check_auth_email_exists` RPC is true. */
export const AUTH_EMAIL_DUPLICATE_CODE = 'AUTH_EMAIL_DUPLICATE';

/** Returned when a Supabase session already exists (rehydration / signed-in user hits Sign up). */
export const ALREADY_SIGNED_IN_CODE = 'ALREADY_SIGNED_IN';
export const ALREADY_SIGNED_IN_MESSAGE =
  'You are already signed in. Log out if you need to use a different account.';

/** Legacy synthetic message; still matches server/auth duplicate copy. */
export const AUTH_EMAIL_DUPLICATE_ERROR = Object.freeze({ message: 'User already registered' });

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
  if (lower.includes('user with this email') && lower.includes('already')) return true;
  if (lower.includes('user already registered') || lower.includes('email already exists')) return true;
  if (lower.includes('duplicate key') && lower.includes('email')) return true;
  return false;
}

/**
 * RPC `check_auth_email_exists` can return true / "true" / 1 depending on client; treat as exist when clearly yes.
 */
export function rpcAuthEmailExistsResultIsTrue(data) {
  if (data === true) return true;
  if (data === false || data == null) return false;
  const s = String(data).trim().toLowerCase();
  return s === 'true' || s === 't' || s === '1' || s === 'yes';
}

/**
 * Maps Supabase Auth errors to clearer copy when Postgres triggers fail during sign-up.
 */
export function describeSignUpFailure(error) {
  if (isAlreadySignedInError(error)) {
    return { title: 'Already signed in', message: ALREADY_SIGNED_IN_MESSAGE };
  }
  if (isEmailAlreadyInUseError(error)) {
    return { title: ACCOUNT_EXISTS_TITLE, message: ACCOUNT_EXISTS_MESSAGE };
  }
  const m = (error && error.message) || String(error || '');
  const lower = m.toLowerCase();
  if (lower.includes('database error saving new user')) {
    return {
      title: 'Sign Up Failed',
      message: 'We could not create your account right now. Please try again or contact support if the issue continues.',
    };
  }
  return { title: 'Sign Up Failed', message: 'Something went wrong. Please try again.' };
}
