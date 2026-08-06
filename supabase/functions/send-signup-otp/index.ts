/**
 * send-signup-otp — Supabase Edge Function
 *
 * Confirm-signup mailer returns 500 on this project. Invite mailer works and is
 * configured with subject "Confirm Your Signup" + {{ .Data.signup_otp }}.
 *
 * Auth user is created only AFTER OTP verification:
 *   POST /send-signup-otp  — email code, delete temp auth user
 *   POST /verify-signup-otp — validate code, create confirmed auth user + session
 *
 * Dashboard: create function `send-signup-otp` (JWT verify off) and also expose
 * verify via the same function by routing on path, or deploy a second function
 * `verify-signup-otp` with the verify handler below.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.52.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MS = 10 * 60 * 1000;
const LOG = '[send-signup-otp]';

/** In-memory pending OTPs (Edge isolate). Prefer a table for multi-instance production. */
const pendingByEmail = new Map<
  string,
  { otpHash: string; meta: Record<string, string>; expiresAt: number }
>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeSecret(raw: string | undefined): string {
  let s = String(raw ?? '').trim().replace(/^\ufeff/, '');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function asPlainMetadata(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v == null || k === 'signup_otp') continue;
    const s = String(v).trim();
    if (s) out[k] = s;
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeOtp(): string {
  return String(100000 + Math.floor(Math.random() * 900000));
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
): Promise<{ id: string; email_confirmed_at?: string | null } | null> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => String(u.email || '').trim().toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json({ error: { message: 'Method not allowed', code: 'method_not_allowed' } }, 405);
  }

  const supabaseUrl = normalizeSecret(Deno.env.get('SUPABASE_URL'));
  const serviceKey = normalizeSecret(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const anonKey = normalizeSecret(Deno.env.get('SUPABASE_ANON_KEY'));
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: { message: 'Signup OTP service is not configured.', code: 'misconfigured' } }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const url = new URL(req.url);
  const isVerify = url.pathname.endsWith('/verify-signup-otp');

  let payload: { email?: string; data?: Record<string, unknown>; token?: string; code?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: { message: 'Invalid JSON body.', code: 'bad_request' } }, 400);
  }

  const normalizedEmail = String(payload.email || '').trim().toLowerCase();
  if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
    return json({ error: { message: 'Please enter a valid email address.', code: 'invalid_email' } }, 400);
  }

  try {
    if (isVerify) {
      const token = String(payload.token || payload.code || '').trim();
      if (!/^\d{6}$/.test(token)) {
        return json({ error: { message: 'Email and 6-digit code are required.', code: 'invalid_request' } }, 400);
      }
      const pending = pendingByEmail.get(normalizedEmail);
      if (!pending) {
        return json(
          { error: { message: 'No verification in progress. Please request a new code.', code: 'no_pending_signup' } },
          400
        );
      }
      if (Date.now() > pending.expiresAt) {
        pendingByEmail.delete(normalizedEmail);
        return json(
          { error: { message: 'This code has expired. Please request a new one.', code: 'otp_expired' } },
          400
        );
      }
      const okHash = await sha256Hex(`${normalizedEmail}:${token}`);
      if (pending.otpHash !== okHash) {
        return json({ error: { message: 'Invalid verification code.', code: 'otp_invalid' } }, 400);
      }

      const existing = await findAuthUserByEmail(admin, normalizedEmail);
      if (existing?.id) {
        const { data: profile } = await admin.from('users').select('id').eq('id', existing.id).maybeSingle();
        if (profile?.id) {
          pendingByEmail.delete(normalizedEmail);
          return json({ error: { message: 'Email already exists!', code: 'AUTH_EMAIL_DUPLICATE' } }, 409);
        }
        await admin.auth.admin.deleteUser(existing.id);
      }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: pending.meta || {},
      });
      if (createErr || !created?.user?.id) {
        return json(
          {
            error: {
              message: createErr?.message || 'Could not create account after verification.',
              code: (createErr as { code?: string })?.code || 'create_user_failed',
            },
          },
          500
        );
      }
      pendingByEmail.delete(normalizedEmail);

      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: normalizedEmail,
      });
      if (My Expo React Native Android APK is showing an OLD app launcher icon.

        Important facts:
        - The correct/new icon appears in Expo / Expo Recents.
        - The installed APK still shows the old/different icon.
        - I already ran:
          eas build --platform android --profile apk --clear-cache
        - The problem still exists.
        - I also uninstalled/reinstalled the APK.
        - app.json currently points to my new icon.
        - The old image may no longer even exist in the assets folder.
        
        Please inspect the entire project and find exactly where the APK is getting the old launcher icon from.
        
        Check specifically:
        
        1. app.json
        2. app.config.js / app.config.ts if they exist
        3. android/app/src/main/AndroidManifest.xml
        4. android/app/src/main/res/mipmap-*
        5. android/app/src/main/res/drawable*
        6. ic_launcher files
        7. ic_launcher_foreground files
        8. ic_launcher_round files
        9. adaptive icon XML files
        10. Any Expo config/plugin that overrides the icon
        11. Whether the existing android/ directory contains stale generated launcher icons.
        
        Also run/check the resolved Expo configuration to verify which icon Expo is actually using.
        
        DO NOT immediately run `expo prebuild --clean` or delete my android folder because there may be existing native modifications.
        
        First:
        - Tell me exactly where the old icon is coming from.
        - Tell me which files need to change.
        - Explain why app.json is not affecting the APK.
        
        Then make only the necessary changes to ensure the Android APK uses the new icon configured in app.json.
        
        After fixing it, tell me the exact EAS command I should use to generate a fresh APK.linkErr || !linkData?.properties?.hashed_token) {
        return json(
          {
            error: {
              message: linkErr?.message || 'Account created but session could not be started.',
              code: 'session_failed',
            },
          },
          500
        );
      }
      const { data: sessionData, error: verifyErr } = await anon.auth.verifyOtp({
        token_hash: linkData.properties.hashed_token,
        type: 'email',
      });
      if (verifyErr || !sessionData?.session) {
        return json(
          {
            error: {
              message: verifyErr?.message || 'Account created but session could not be started.',
              code: 'session_failed',
            },
          },
          500
        );
      }
      return json({ data: { user: sessionData.user, session: sessionData.session }, error: null });
    }

    // --- send ---
    const userData = asPlainMetadata(payload.data);
    const existing = await findAuthUserByEmail(admin, normalizedEmail);
    if (existing?.id) {
      const { data: profile } = await admin.from('users').select('id').eq('id', existing.id).maybeSingle();
      if (profile?.id) {
        return json({ error: { message: 'Email already exists!', code: 'AUTH_EMAIL_DUPLICATE' } }, 409);
      }
      await admin.auth.admin.deleteUser(existing.id);
    }

    const signupOtp = makeOtp();
    pendingByEmail.set(normalizedEmail, {
      otpHash: await sha256Hex(`${normalizedEmail}:${signupOtp}`),
      meta: userData,
      expiresAt: Date.now() + OTP_TTL_MS,
    });

    console.log(LOG, 'email sending started (Confirm Your Signup)');
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      data: { ...userData, signup_otp: signupOtp },
    });
    if (inviteErr) {
      pendingByEmail.delete(normalizedEmail);
      return json(
        {
          error: {
            message: inviteErr.message || 'Error sending confirmation email',
            code: (inviteErr as { code?: string }).code || 'otp_send_failed',
          },
        },
        500
      );
    }
    if (invited?.user?.id) {
      try {
        await admin.auth.admin.deleteUser(invited.user.id);
      } catch (_) {}
    }
    const still = await findAuthUserByEmail(admin, normalizedEmail);
    if (still?.id) {
      try {
        await admin.auth.admin.deleteUser(still.id);
      } catch (_) {}
    }

    console.log(LOG, 'email sending completed; auth user deferred until verify');
    return json({ data: { ok: true }, pending: true, otp_type: 'signup_pending', error: null });
  } catch (e) {
    console.error(LOG, 'unexpected:', (e as Error)?.message || e);
    return json(
      {
        error: {
          message: (e as Error)?.message || 'Could not send verification code.',
          code: 'unexpected_failure',
        },
      },
      500
    );
  }
});
