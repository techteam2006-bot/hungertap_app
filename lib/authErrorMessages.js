/** Offline / transport failure during auth (login, OTP, password reset). */
export const AUTH_NETWORK_ERROR_CODE = 'network_error';
export const AUTH_NETWORK_ERROR_MESSAGE =
  'Connection error. Please check your internet and try again.';

/** Shown when the email is already registered (Supabase + common variants). */
export const ACCOUNT_EXISTS_TITLE = 'Account already exists';
export const ACCOUNT_EXISTS_MESSAGE = 'Email already exists!';
export const EMAIL_ALREADY_EXISTS_MESSAGE = 'Email already exists!';

/** Client/UI code when Auth reports the email is already registered. */
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
  if (lower.includes('user_already_registered')) return true;
  if (lower.includes('user with this email') && lower.includes('already')) return true;
  if (lower.includes('user already registered') || lower.includes('email already exists')) return true;
  if (lower.includes('duplicate key') && lower.includes('email')) return true;
  if (error && String(error.code || '').toLowerCase() === 'user_already_registered') return true;
  return false;
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
 * Maps Supabase Auth errors to clearer copy when Postgres triggers fail during sign-up.
 */
export function describeSignUpFailure(error) {
  if (isAlreadySignedInError(error)) {
    return { title: 'Already signed in', message: ALREADY_SIGNED_IN_MESSAGE };
  }
  if (isEmailAlreadyInUseError(error)) {
    return { title: ACCOUNT_EXISTS_TITLE, message: EMAIL_ALREADY_EXISTS_MESSAGE };
  }
  const m = (error && error.message) || String(error || '');
  const lower = m.toLowerCase();
  if (lower.includes('database error saving new user')) {
    return {
      title: 'Sign Up Failed',
      message: 'We could not create your account right now. Please try again or contact support if the issue continues.',
    };
  }
  if (
    lower.includes('same password') ||
    lower.includes('should be different') ||
    lower.includes('different from the old')
  ) {
    return {
      title: 'Almost done',
      message: 'Your password is already set. Tap Sign Up again to finish linking your canteen, or log in.',
    };
  }
  return { title: 'Sign Up Failed', message: 'Something went wrong. Please try again.' };
}
