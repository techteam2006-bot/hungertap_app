import { CONFIG } from '../config';

/**
 * Signup OTP via Edge/local workaround (bypasses broken Confirm-signup mailer).
 * @param {string} email
 * @param {Record<string, string>} [userData]
 */
export async function sendSignupOtpViaEdge(email, userData = {}) {
  const base = String(CONFIG.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = String(CONFIG.SUPABASE_ANON_KEY || '').trim();
  const override = String(CONFIG.SEND_SIGNUP_OTP_URL || '').trim().replace(/\/$/, '');
  const url = override || (base ? `${base}/functions/v1/send-signup-otp` : '');

  if (!url || !anon) {
    return {
      data: null,
      error: { message: 'Signup OTP service is not configured.', code: 'misconfigured' },
    };
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const payload = {
    email: normalizedEmail,
    data: userData && typeof userData === 'object' ? userData : {},
  };

  console.log('[sendSignupOtpViaEdge] request', {
    url,
    email: normalizedEmail,
    metadataKeys: Object.keys(payload.data),
  });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        // localtunnel interstitial bypass when using *.loca.lt during local dev
        'Bypass-Tunnel-Reminder': 'true',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('[sendSignupOtpViaEdge] network:', e?.message || e);
    return {
      data: null,
      error: {
        message:
          'Could not reach the verification service. Check that the signup OTP server/tunnel is running, then try again.',
        code: 'network_error',
      },
    };
  }

  let body = null;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }

  console.log('[sendSignupOtpViaEdge] response', {
    status: response.status,
    ok: response.ok,
    error: body?.error || body?.message || null,
  });

  if (!response.ok) {
    const errFromBody =
      body?.error && typeof body.error === 'object'
        ? body.error
        : {
            message:
              (typeof body?.error === 'string' && body.error) ||
              (typeof body?.message === 'string' && body.message) ||
              (typeof body?.msg === 'string' && body.msg) ||
              'We could not send a verification code. Please try again.',
            code: body?.error_code || body?.code,
          };
    return {
      data: null,
      error: {
        message: errFromBody.message || String(errFromBody),
        code: errFromBody.code,
        status: response.status,
      },
    };
  }

  if (body?.error) {
    return {
      data: null,
      error: {
        message: body.error.message || String(body.error),
        code: body.error.code,
      },
    };
  }

  return { data: body?.data ?? body, pending: true, error: null };
}
