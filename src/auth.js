// Signed sign-in tokens (HMAC-SHA256) and constant-time credential checks.

const enc = new TextEncoder();

const b64url = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export function teacherConfigured(env) {
  return typeof env.teacher_user === 'string' && env.teacher_user.length > 0 && typeof env.teacher_password === 'string' && env.teacher_password.length > 0;
}

async function key(env) {
  // Optional session_secret; otherwise derive a key from the teacher credentials.
  const secret = env.session_secret || `dialogue-dungeon|${env.teacher_user}|${env.teacher_password}`;
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signToken(env, payload, ttlSeconds) {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await key(env), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifyToken(env, token) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await key(env), unb64url(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

async function sha(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(s))));
}

export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha(a), sha(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Class codes: 6 characters, no 0/O/1/I/L so they are easy to read out and type.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newClassCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (const b of bytes) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}
export const cleanCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Teacher account passwords: PBKDF2-SHA256 (100000 rounds is the most Workers allows), stored as "pbkdf2$rounds$salt$hash".
const ROUNDS = 100000;
const pbkdf2 = async (password, salt, rounds) => {
  const k = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, k, 256));
};
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ROUNDS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, ROUNDS))}`;
}
// Always does the same work, even for a missing account (stored = null), so timing does not reveal which usernames exist.
export async function checkPassword(password, stored) {
  const parts = String(stored || '').split('$');
  const ok = parts.length === 4 && parts[0] === 'pbkdf2' && Number(parts[1]) > 0 && Number(parts[1]) <= ROUNDS;
  const salt = ok ? unb64url(parts[2]) : new Uint8Array(16);
  const got = await pbkdf2(password, salt, ok ? Number(parts[1]) : ROUNDS);
  const want = ok ? unb64url(parts[3]) : new Uint8Array(32);
  let diff = got.length ^ want.length;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ (want[i] || 0);
  return ok && diff === 0;
}
export function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}
export const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 100;
