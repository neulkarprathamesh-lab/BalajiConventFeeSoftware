import {
  saveOfflineVerifier, verifyOfflineCredentials, forgetOfflineVerifier,
  startOfflineSession, restoreOfflineSession, clearOfflineSession, SESSION_KEY,
} from './offlineAuth';
import { openDb, idbPut, idbGet, STORE_AUTH } from './offlineDb';

const USER = { id: 'u1', name: 'Cashier One', email: 'cashier@school.test', role: 'cashier', password_hash: 'SECRET-HASH' };
const PASSWORD = 'Correct-Horse-9';

async function clearAuthStore() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUTH, 'readwrite');
    tx.objectStore(STORE_AUTH).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await clearAuthStore();
});

describe('offline sign-in verifier', () => {
  test('a user who signed in online can sign in offline with the same password', async () => {
    await saveOfflineVerifier({ email: USER.email, password: PASSWORD, user: USER });
    const res = await verifyOfflineCredentials(USER.email, PASSWORD);
    expect(res.ok).toBe(true);
    expect(res.user.name).toBe('Cashier One');
  });

  test('wrong password is refused', async () => {
    await saveOfflineVerifier({ email: USER.email, password: PASSWORD, user: USER });
    expect(await verifyOfflineCredentials(USER.email, 'wrong-password')).toEqual({ ok: false, reason: 'bad_password' });
  });

  test('a user who never signed in on this PC is refused', async () => {
    expect(await verifyOfflineCredentials('stranger@school.test', PASSWORD)).toEqual({ ok: false, reason: 'no_record' });
  });

  test('email matching ignores case and spaces', async () => {
    await saveOfflineVerifier({ email: ' Cashier@School.test ', password: PASSWORD, user: USER });
    expect((await verifyOfflineCredentials('cashier@school.test', PASSWORD)).ok).toBe(true);
  });

  test('the password itself is never stored - only a PBKDF2 hash with a salt', async () => {
    await saveOfflineVerifier({ email: USER.email, password: PASSWORD, user: USER });
    const row = await idbGet(STORE_AUTH, USER.email);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain('SECRET-HASH'); // server password hash is dropped too
    expect(row.algo).toBe('PBKDF2-SHA256');
    expect(row.iterations).toBeGreaterThanOrEqual(310000);
    expect(row.salt).toBeTruthy();
  });

  test('two users with the same password get different stored hashes (per-user salt)', async () => {
    await saveOfflineVerifier({ email: 'a@school.test', password: PASSWORD, user: { ...USER, email: 'a@school.test' } });
    await saveOfflineVerifier({ email: 'b@school.test', password: PASSWORD, user: { ...USER, email: 'b@school.test' } });
    const a = await idbGet(STORE_AUTH, 'a@school.test');
    const b = await idbGet(STORE_AUTH, 'b@school.test');
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  test('a revoked account (verifier forgotten) can no longer sign in offline', async () => {
    await saveOfflineVerifier({ email: USER.email, password: PASSWORD, user: USER });
    await forgetOfflineVerifier(USER.email);
    expect(await verifyOfflineCredentials(USER.email, PASSWORD)).toEqual({ ok: false, reason: 'no_record' });
  });

  test('offline sign-in expires when the last online sign-in is too old', async () => {
    await saveOfflineVerifier({ email: USER.email, password: PASSWORD, user: USER });
    const row = await idbGet(STORE_AUTH, USER.email);
    const longAgo = new Date(Date.now() - 120 * 86400000).toISOString();
    await idbPut(STORE_AUTH, { ...row, verified_online_at: longAgo });
    expect(await verifyOfflineCredentials(USER.email, PASSWORD)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('offline session token', () => {
  test('a session restores after a reload while the token is still in this client session', async () => {
    await startOfflineSession(USER);
    const restored = await restoreOfflineSession();
    expect(restored.id).toBe('u1');
    expect(restored.password_hash).toBeUndefined();
  });

  test('the token itself is not kept in localStorage - only its hash', async () => {
    await startOfflineSession(USER);
    const record = localStorage.getItem(SESSION_KEY);
    const token = sessionStorage.getItem('bc_offline_token');
    expect(token).toBeTruthy();
    expect(record).not.toContain(token);
  });

  test('a session is not restored once the client-session token is gone (app was closed)', async () => {
    await startOfflineSession(USER);
    sessionStorage.clear();
    expect(await restoreOfflineSession()).toBeNull();
  });

  test('a forged or swapped token is rejected', async () => {
    await startOfflineSession(USER);
    sessionStorage.setItem('bc_offline_token', 'forged-token');
    expect(await restoreOfflineSession()).toBeNull();
  });

  test('an expired session is rejected and cleared', async () => {
    await startOfflineSession(USER);
    const rec = JSON.parse(localStorage.getItem(SESSION_KEY));
    rec.expiresAt = new Date(Date.now() - 1000).toISOString();
    localStorage.setItem(SESSION_KEY, JSON.stringify(rec));
    expect(await restoreOfflineSession()).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test('clearing the session (logout) removes it everywhere', async () => {
    await startOfflineSession(USER);
    await clearOfflineSession();
    expect(await restoreOfflineSession()).toBeNull();
  });
});
