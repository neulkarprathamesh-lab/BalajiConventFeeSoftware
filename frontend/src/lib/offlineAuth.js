/**
 * Offline sign-in for users who have signed in successfully on THIS PC before.
 *
 * What is stored, and what is not:
 *  - The password is never stored, in any form.
 *  - After each successful ONLINE sign-in, a verifier is saved in IndexedDB
 *    ('auth' store, keyed by email): a PBKDF2-SHA256 hash of the password with a
 *    random 16-byte salt and 310,000 iterations (OWASP guidance). Guessing the
 *    password from the verifier costs one full PBKDF2 run per guess.
 *  - The verifier is removed when the server refuses the account outright
 *    (deactivated, 403 on sign-in). Offline access also expires once the last
 *    ONLINE sign-in is older than MAX_OFFLINE_DAYS.
 *
 * Offline session token:
 *  - Offline sign-in issues a random 32-byte token. The token itself lives only
 *    in sessionStorage (cleared when the client closes). localStorage keeps only
 *    its SHA-256 hash, the user profile the screens need, and an expiry time
 *    (SESSION_HOURS, same as the 12 h server session).
 *  - A cached session restores on a restart ONLY when sessionStorage still holds
 *    the matching token. Otherwise the user signs in again (offline or online).
 *
 * Known limits (also in the release notes):
 *  - A password changed on the server is accepted offline with the OLD password
 *    until that user signs in online once.
 *  - Role and permission changes made on the server reach this PC at the next
 *    online sign-in.
 */
import { idbGet, idbPut, idbDelete, STORE_AUTH } from './offlineDb';

export const PBKDF2_ITERATIONS = 310000;
export const MAX_OFFLINE_DAYS = 90;
export const SESSION_HOURS = 12;
export const SESSION_KEY = 'bc_offline_session';
const TOKEN_STORAGE_KEY = 'bc_offline_token';

const enc = (s) => new TextEncoder().encode(String(s));

function toB64(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

async function sha256B64(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toB64(new Uint8Array(digest));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Only the profile fields the screens use. Nothing secret is kept.
function profileOf(user) {
  if (!user) return null;
  const { password_hash, password, token, ...rest } = user; // eslint-disable-line no-unused-vars
  return rest;
}

/** Saves (or replaces) the offline verifier after a successful ONLINE sign-in. */
export async function saveOfflineVerifier({ email, password, user }) {
  const key = String(email || '').trim().toLowerCase();
  if (!key || !password || !user) return false;
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  await idbPut(STORE_AUTH, {
    email: key,
    user: profileOf(user),
    algo: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    hash: toB64(hash),
    verified_online_at: new Date().toISOString(),
  });
  return true;
}

/** Deletes the verifier, e.g. when the server has deactivated the account. */
export async function forgetOfflineVerifier(email) {
  const key = String(email || '').trim().toLowerCase();
  if (key) await idbDelete(STORE_AUTH, key);
}

/**
 * Checks a password offline. Returns { ok:true, user } or { ok:false, reason }
 * where reason is 'no_record' | 'expired' | 'bad_password'.
 */
export async function verifyOfflineCredentials(email, password) {
  const key = String(email || '').trim().toLowerCase();
  const rec = key ? await idbGet(STORE_AUTH, key) : null;
  if (!rec) return { ok: false, reason: 'no_record' };
  const ageDays = (Date.now() - new Date(rec.verified_online_at).getTime()) / 86400000;
  if (!(ageDays <= MAX_OFFLINE_DAYS)) return { ok: false, reason: 'expired' };
  const candidate = await pbkdf2(password || '', fromB64(rec.salt), rec.iterations);
  if (!constantTimeEqual(candidate, fromB64(rec.hash))) return { ok: false, reason: 'bad_password' };
  return { ok: true, user: rec.user };
}

function storage(kind) {
  try { return window[kind]; } catch (_) { return null; }
}

/** Starts an offline session for `user`. Returns the expiry time (ISO). */
export async function startOfflineSession(user) {
  const token = toB64(randomBytes(32));
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  const record = { tokenHash: await sha256B64(enc(token)), expiresAt, user: profileOf(user) };
  storage('sessionStorage')?.setItem(TOKEN_STORAGE_KEY, token);
  storage('localStorage')?.setItem(SESSION_KEY, JSON.stringify(record));
  return expiresAt;
}

/** The user of a still-valid offline session, or null. Never throws. */
export async function restoreOfflineSession() {
  try {
    const token = storage('sessionStorage')?.getItem(TOKEN_STORAGE_KEY);
    const raw = storage('localStorage')?.getItem(SESSION_KEY);
    if (!token || !raw) return null;
    const record = JSON.parse(raw);
    if (!record || !record.user || !(new Date(record.expiresAt).getTime() > Date.now())) {
      await clearOfflineSession();
      return null;
    }
    if ((await sha256B64(enc(token))) !== record.tokenHash) {
      await clearOfflineSession();
      return null;
    }
    return record.user;
  } catch (_) {
    return null;
  }
}

export async function clearOfflineSession() {
  storage('sessionStorage')?.removeItem(TOKEN_STORAGE_KEY);
  storage('localStorage')?.removeItem(SESSION_KEY);
}
