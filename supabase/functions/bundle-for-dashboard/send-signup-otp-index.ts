/**
 * send-signup-otp — Supabase Edge Function
 *
 * Root cause: new-user signup OTP uses the Confirm-signup mailer, which returns
 *   500 "Error sending confirmation email"
 * while Magic Link (confirmed users) and Recovery emails work.
 *
 * Fix: create/reuse auth user as email_confirm=true, then send Magic Link OTP.
 *
 * Dashboard: Edge Functions → Create `send-signup-otp` → paste this file →
 * disable "Verify JWT". Secrets SUPABASE_URL / SERVICE_ROLE / ANON are auto-injected.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.52.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOG = '[send-signup-otp]';

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
    if (v == null) continue;
    const s = String(v).trim();
    if (s) out[k] = s;
  }
  return out;
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

  let payload: { email?: string; data?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return json({ error: { message: 'Invalid JSON body.', code: 'bad_request' } }, 400);
  }

  const normalizedEmail = String(payload.email || '').trim().toLowerCase();
  console.log(LOG, 'request received', { email: normalizedEmail });
  if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
    return json({ error: { message: 'Please enter a valid email address.', code: 'invalid_email' } }, 400);
  }

  const userData = asPlainMetadata(payload.data);
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const existing = await findAuthUserByEmail(admin, normalizedEmail);
    let authUserId: string | null = existing?.id ?? null;

    if (existing) {
      const { data: profile } = await admin.from('users').select('id').eq('id', existing.id).maybeSingle();
      if (profile?.id) {
        return json({ error: { message: 'Email already exists!', code: 'AUTH_EMAIL_DUPLICATE' } }, 409);
      }
      console.log(LOG, 'incomplete signup; confirm + metadata', existing.id);
      await admin.auth.admin.updateUserById(existing.id, {
        email_confirm: true,
        ...(Object.keys(userData).length ? { user_metadata: userData } : {}),
      });
    } else {
      console.log(LOG, 'create confirmed user (bypass broken confirm-signup mailer)');
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: userData,
      });
      if (createErr || !created?.user?.id) {
        const msg = String(createErr?.message || '');
        if (/already|registered|exists/i.test(msg)) {
          return json({ error: { message: 'Email already exists!', code: 'AUTH_EMAIL_DUPLICATE' } }, 409);
        }
        return json(
          {
            error: {
              message: createErr?.message || 'Could not prepare verification.',
              code: createErr?.code || 'create_user_failed',
            },
          },
          500
        );
      }
      authUserId = created.user.id;
      console.log(LOG, 'OTP user saved', authUserId);
    }

    console.log(LOG, 'email sending started (recovery OTP — 6-digit code)');
    // Magic Link = ConfirmationURL link. Recovery template uses {{ .Token }} (same as Reset Password).
    // Confirm-signup mailer returns 500 on this project, so signup uses recovery OTP instead.
    const { data: otpData, error: otpErr } = await anon.auth.resetPasswordForEmail(normalizedEmail);
    if (otpErr) {
      console.error(LOG, 'resetPasswordForEmail failed:', otpErr.message);
      if (!existing && authUserId) {
        try {
          await admin.auth.admin.deleteUser(authUserId);
        } catch (_) {}
      }
      return json(
        {
          error: {
            message: otpErr.message || 'Error sending confirmation email',
            code: (otpErr as { code?: string }).code || 'otp_send_failed',
          },
        },
        500
      );
    }
    console.log(LOG, 'email sending completed');
    return json({
      data: otpData ?? { ok: true },
      pending: true,
      otp_type: 'recovery',
      error: null,
    });
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
