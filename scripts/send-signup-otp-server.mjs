/**
 * Local Node equivalent of Edge Function send-signup-otp.
 * Run: node scripts/send-signup-otp-server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SEND_SIGNUP_OTP_PORT || 8787);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOG = '[send-signup-otp-server]';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(path.resolve(__dirname, '../../canteen_web2/.env'));
loadEnvFile(path.resolve(__dirname, '../.env'));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON =
  process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON) {
  console.error(LOG, 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / anon key');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(SUPABASE_URL, ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function asPlainMetadata(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) out[k] = s;
  }
  return out;
}

async function findAuthUserByEmail(email) {
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

async function handleSendSignupOtp(body) {
  const normalizedEmail = String(body?.email || '').trim().toLowerCase();
  console.log(LOG, 'request received', { email: normalizedEmail });
  if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
    return {
      status: 400,
      body: { error: { message: 'Please enter a valid email address.', code: 'invalid_email' } },
    };
  }

  const userData = asPlainMetadata(body?.data);
  const existing = await findAuthUserByEmail(normalizedEmail);
  let authUserId = existing?.id ?? null;

  if (existing) {
    const { data: profile } = await admin.from('users').select('id').eq('id', existing.id).maybeSingle();
    if (profile?.id) {
      return {
        status: 409,
        body: { error: { message: 'Email already exists!', code: 'AUTH_EMAIL_DUPLICATE' } },
      };
    }
    console.log(LOG, 'incomplete signup; confirming', existing.id);
    await admin.auth.admin.updateUserById(existing.id, {
      email_confirm: true,
      ...(Object.keys(userData).length ? { user_metadata: userData } : {}),
    });
  } else {
    console.log(LOG, 'create confirmed user');
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: true,
      user_metadata: userData,
    });
    if (createErr || !created?.user?.id) {
      return {
        status: 500,
        body: {
          error: {
            message: createErr?.message || 'Could not prepare verification.',
            code: createErr?.code || 'create_user_failed',
          },
        },
      };
    }
    authUserId = created.user.id;
    console.log(LOG, 'OTP saved', authUserId);
  }

  // Same path as Reset Password: Recovery template uses {{ .Token }} (6-digit OTP).
  // Confirm-signup / Magic Link for new users is broken on this project.
  console.log(LOG, 'email sending started (recovery OTP)');
  const { data: otpData, error: otpErr } = await anon.auth.resetPasswordForEmail(normalizedEmail);
  if (otpErr) {
    console.error(LOG, 'resetPasswordForEmail:', otpErr.message);
    if (!existing && authUserId) {
      try {
        await admin.auth.admin.deleteUser(authUserId);
      } catch (_) {}
    }
    return {
      status: 500,
      body: {
        error: {
          message: otpErr.message || 'Error sending confirmation email',
          code: otpErr.code || 'otp_send_failed',
        },
      },
    };
  }
  console.log(LOG, 'email sending completed');
  return {
    status: 200,
    body: { data: otpData ?? { ok: true }, pending: true, otp_type: 'recovery', error: null },
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const pathName = req.url?.split('?')[0];
  if (req.method !== 'POST' || (pathName !== '/send-signup-otp' && pathName !== '/functions/v1/send-signup-otp')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not found' } }));
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON body.' } }));
    return;
  }
  try {
    const result = await handleSendSignupOtp(parsed);
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
  } catch (e) {
    console.error(LOG, e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: e?.message || 'unexpected_failure' } }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(LOG, `listening on http://0.0.0.0:${PORT}/send-signup-otp`);
});
