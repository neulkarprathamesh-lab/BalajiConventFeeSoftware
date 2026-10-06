import { API_BASE, appVersion } from './runtime';
import { idbGet, idbGetAll, idbPut, idbDelete, STORE_OPS, STORE_CACHE } from './offlineDb';
import { nextRetryDelayMs, CONNECTED_POLL_MS, SIGNIN_POLL_MS, summarizeOps, cachedGetFor } from './syncPolicy';

/**
 * Offline-first sync engine (desktop client and web Client PCs).
 *
 * Design (mirrors backend/routers/sync.py):
 *  - device_id is a UUID generated once and kept in localStorage.
 *  - Every queued operation gets a random `local_id`. A retry re-sends the SAME
 *    local_id, so the server's sync_operations unique index means it can never
 *    create the receipt, expense or bill twice. Receipt numbers are assigned by
 *    the server at push time (the same counter the online path uses), never on
 *    the PC.
 *  - queueOperation(..., { dedupeKey }) returns the already-queued operation when
 *    the same form submission is queued again (double click, re-render), so one
 *    user action cannot queue two records on this PC.
 *  - Connectivity: GET /api/version (no auth). When it fails the engine goes
 *    Offline and retries with backoff (3 s, 6 s, 12 s, 24 s, then every 30 s).
 *    When the server answers again it resumes at once: no restart, no button.
 *  - Status values: connecting | connected | syncing | offline | auth_required | error.
 */

const DEVICE_ID_KEY = 'feehub_device_id';
const DEVICE_SECRET_KEY = 'feehub_device_secret';
const TOKEN_KEY = 'bc_token';
const PROBE_TIMEOUT_MS = 4000;

function uuid() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// Optional per-device credential (see routers/sync.py set_device_password).
// Only sent once an administrator has assigned one for this device_id.
export function getDeviceSecret() {
  return localStorage.getItem(DEVICE_SECRET_KEY) || '';
}
export function setDeviceSecret(secret) {
  if (secret) localStorage.setItem(DEVICE_SECRET_KEY, secret);
  else localStorage.removeItem(DEVICE_SECRET_KEY);
}
function deviceAuthHeaders() {
  const secret = getDeviceSecret();
  return secret ? { 'X-Device-Secret': secret } : {};
}

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readDetail(res) {
  try {
    const body = await res.json();
    return typeof body.detail === 'string' ? body.detail : '';
  } catch (_) {
    return '';
  }
}

// ---------------- Pub/sub for UI status ----------------
const listeners = new Set();
let state = {
  status: 'connecting',   // connecting | connected | syncing | offline | auth_required | error
  online: false,          // last probe of the Main Server succeeded
  lastSyncAt: null,       // ISO time of the last completed sync
  pendingCount: 0,        // queued changes not yet confirmed by the server
  failedCount: 0,         // subset of pendingCount the server rejected (needs attention)
  lastError: null,
  failures: 0,            // consecutive failed passes while offline/error (drives backoff)
  nextRetryAt: null,      // ISO time of the next automatic attempt while offline
};

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((cb) => { try { cb(state); } catch (e) { /* a broken listener must not stop sync */ } });
}

export function subscribe(cb) {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

export function getState() {
  return state;
}

export function isOnline() {
  return state.online;
}

// ---------------- Connectivity ----------------
export async function checkConnectivity(timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${API_BASE}/api/version`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    return res.ok;
  } catch (e) {
    return false;
  }
}

// ---------------- Pending operations queue ----------------
// Queue writes are serialized so two rapid submissions cannot both pass the
// dedupe check and both be stored.
let queueChain = Promise.resolve();
function serialQueue(fn) {
  const run = queueChain.then(fn, fn);
  queueChain = run.catch(() => {});
  return run;
}

// Stable JSON (keys sorted) so the same form content always gives the same text.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Content fingerprint of a queued create. Two identical submissions (for example
 * the same payment saved again after navigating back) map to one queued record.
 */
export function payloadFingerprint(opType, payload) {
  return `${opType}:${stableStringify(payload)}`;
}

/**
 * Queues an offline CREATE. Returns the queued operation. If an identical operation
 * is still waiting to sync, that one is returned with `duplicate: true` and nothing
 * new is stored. `options.dedupeKey` overrides the content fingerprint when a caller
 * has its own notion of "the same submission".
 */
export function queueOperation(opType, payload, options = {}) {
  const dedupeKey = (options && options.dedupeKey) || payloadFingerprint(opType, payload);
  return serialQueue(async () => {
    const existing = (await idbGetAll(STORE_OPS)).find((o) => o.dedupe_key === dedupeKey && o.status !== 'applied');
    if (existing) return { ...existing, duplicate: true };
    const op = {
      local_id: uuid(), op_type: opType, payload,
      client_created_at: new Date().toISOString(), status: 'pending', retry_count: 0,
      dedupe_key: dedupeKey,
    };
    await idbPut(STORE_OPS, op);
    await refreshPendingCount();
    kickSync();
    return op;
  });
}

export async function getPendingOps() {
  return idbGetAll(STORE_OPS);
}

export async function refreshPendingCount() {
  const counts = summarizeOps(await idbGetAll(STORE_OPS));
  setState({ pendingCount: counts.waiting, failedCount: counts.failed });
  return counts.waiting;
}

// ---------------- Local cache (last synced snapshot) ----------------
export async function getCachedStudents() {
  const row = await idbGet(STORE_CACHE, 'students');
  return (row && row.value) || [];
}

export async function getCachedMeta() {
  const [fs, dept, cls, settings, rt] = await Promise.all([
    idbGet(STORE_CACHE, 'fee_structures'), idbGet(STORE_CACHE, 'departments'),
    idbGet(STORE_CACHE, 'classes'), idbGet(STORE_CACHE, 'settings'),
    idbGet(STORE_CACHE, 'receipt_types'),
  ]);
  return {
    fee_structures: (fs && fs.value) || [], departments: (dept && dept.value) || [],
    classes: (cls && cls.value) || [], settings: (settings && settings.value) || {},
    receipt_types: (rt && rt.value) || [],
  };
}

const SNAPSHOT_KEYS = ['students', 'fee_structures', 'departments', 'classes', 'receipt_types', 'settings', 'bus_routes'];

/** Everything the offline GET fallback (api.js) may serve, in one read. */
export async function getCachedSnapshot() {
  const rows = await Promise.all(SNAPSHOT_KEYS.map((k) => idbGet(STORE_CACHE, k)));
  const snap = {};
  SNAPSHOT_KEYS.forEach((k, i) => { snap[k] = rows[i] && rows[i].value !== undefined ? rows[i].value : undefined; });
  return snap;
}

export async function readCachedGet(url, params) {
  return cachedGetFor(url, params, await getCachedSnapshot());
}

// Case-insensitive substring match on name/admission_no against the last
// synced student snapshot.
export async function searchCachedStudents(q, { busOnly = false, limit = 8 } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [];
  const all = await getCachedStudents();
  return all
    .filter((s) => (!busOnly || s.bus_required))
    .filter((s) => (s.name || '').toLowerCase().includes(needle) || (s.admission_no || '').toLowerCase().includes(needle))
    .slice(0, limit);
}

export async function getCachedStudentById(id) {
  const all = await getCachedStudents();
  return all.find((s) => s.id === id) || null;
}

export async function getCachedSyncedAt() {
  const row = await idbGet(STORE_CACHE, 'students');
  return (row && row.synced_at) || null;
}

async function storeSnapshot(data) {
  const values = {
    students: data.students || [],
    fee_structures: data.fee_structures || [],
    departments: data.departments || [],
    classes: data.classes || [],
    receipt_types: data.receipt_types || [],
    settings: data.settings || {},
    bus_routes: data.bus_routes || [],
  };
  for (const key of Object.keys(values)) {
    await idbPut(STORE_CACHE, { key, value: values[key], synced_at: data.synced_at });
  }
}

// ---------------- Sync ----------------
function markOffline(reason) {
  setState({
    status: 'offline', online: false, lastError: reason || null,
    failures: state.failures + 1,
  });
  return refreshPendingCount().then(() => state);
}

async function applyPushResults(sent, results) {
  for (const r of results) {
    const op = sent.find((o) => o.local_id === r.local_id);
    if (!op) continue;
    if (r.status === 'applied') {
      await idbPut(STORE_OPS, { ...op, status: 'applied', result: r.result });
    } else if (r.error) {
      await idbPut(STORE_OPS, { ...op, status: 'failed', retry_count: (op.retry_count || 0) + 1, error: r.error });
    }
  }
}

async function runSync() {
  const deviceId = getDeviceId();
  setState({ status: 'syncing', lastError: null });

  const reachable = await checkConnectivity();
  if (!reachable) return markOffline('The Main Server did not respond. Working offline.');
  setState({ online: true });

  if (!localStorage.getItem(TOKEN_KEY)) {
    // Server reachable, but nobody is signed in to the server on this PC
    // (typically after an offline sign-in). Queued work waits for a sign-in.
    setState({ status: 'auth_required', failures: 0, nextRetryAt: null });
    await refreshPendingCount();
    return state;
  }

  try {
    // Heartbeat (cheap; tells Admin's Connected PCs this device is alive).
    const pendingBefore = (await idbGetAll(STORE_OPS)).filter((o) => o.status !== 'applied');
    const hb = await fetch(`${API_BASE}/api/devices/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...deviceAuthHeaders() },
      body: JSON.stringify({ device_id: deviceId, app_version: appVersion(), pending_count: pendingBefore.length }),
    });
    if (hb.status === 403) {
      // Revoked by an administrator (see routers/sync.py). Forget the id so the
      // next pass registers this PC again under a fresh device_id. Queued
      // operations are keyed by their own local_id, so nothing is lost.
      localStorage.removeItem(DEVICE_ID_KEY);
      localStorage.removeItem(DEVICE_SECRET_KEY);
      setState({ status: 'error', failures: state.failures + 1, lastError: 'This PC was revoked by an administrator. Registering again automatically...' });
      await refreshPendingCount();
      return state;
    }
    if (hb.status === 401) {
      const detail = await readDetail(hb);
      if (/device credential/i.test(detail)) {
        // An admin-assigned device password was rejected. Generating a new id
        // here would bypass it, so this is left for an administrator to fix.
        setState({ status: 'error', failures: state.failures + 1, lastError: "This PC's credential was rejected by the Main Server. Ask an administrator to reset its device password." });
        await refreshPendingCount();
        return state;
      }
      // Sign-in expired (12 h session). Keep everything queued until the user signs in again.
      setState({ status: 'auth_required', failures: 0, lastError: null });
      await refreshPendingCount();
      return state;
    }
    if (!hb.ok) throw new Error(`Heartbeat failed with HTTP ${hb.status}`);

    // Push queued creates (each with its stable local_id; safe to retry).
    if (pendingBefore.length) {
      const res = await fetch(`${API_BASE}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), ...deviceAuthHeaders() },
        body: JSON.stringify({
          device_id: deviceId,
          operations: pendingBefore.map((o) => ({
            local_id: o.local_id, op_type: o.op_type, payload: o.payload, client_created_at: o.client_created_at,
          })),
        }),
      });
      if (res.status === 401) {
        setState({ status: 'auth_required', failures: 0, lastError: null });
        await refreshPendingCount();
        return state;
      }
      if (!res.ok) throw new Error(`Push failed with HTTP ${res.status}`);
      const data = await res.json();
      await applyPushResults(pendingBefore, data.results || []);
    }

    // Pull master data for offline reads (a full snapshot, as before).
    const pullRes = await fetch(`${API_BASE}/api/sync/pull?device_id=${encodeURIComponent(deviceId)}`, {
      headers: { ...authHeaders(), ...deviceAuthHeaders() },
    });
    if (pullRes.status === 401) {
      setState({ status: 'auth_required', failures: 0, lastError: null });
      await refreshPendingCount();
      return state;
    }
    if (!pullRes.ok) throw new Error(`Pull failed with HTTP ${pullRes.status}`);
    await storeSnapshot(await pullRes.json());

    // Confirmed operations leave the queue (their results remain in server history).
    const all = await idbGetAll(STORE_OPS);
    for (const o of all) {
      if (o.status === 'applied') await idbDelete(STORE_OPS, o.local_id);
    }
    await refreshPendingCount();
    setState({
      status: 'connected', online: true, lastSyncAt: new Date().toISOString(),
      failures: 0, nextRetryAt: null, lastError: null,
    });
  } catch (e) {
    // Connection dropped mid-sync or the server answered with an error: treated
    // like offline, so the retry schedule takes over.
    return markOffline(e && e.message ? e.message : String(e));
  }
  return state;
}

let inFlight = null;

/** Runs one sync pass. Concurrent calls share the pass already in progress. */
export function syncNow() {
  if (!inFlight) {
    inFlight = runSync().finally(() => { inFlight = null; });
  }
  return inFlight;
}

// ---------------- Scheduler ----------------
let running = false;
let timer = null;
let detachBrowserEvents = null;

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function delayFor(s) {
  switch (s.status) {
    case 'connected': return CONNECTED_POLL_MS;
    case 'auth_required': return SIGNIN_POLL_MS;
    case 'offline':
    case 'error':
      return nextRetryDelayMs(s.failures);
    default:
      return nextRetryDelayMs(1);
  }
}

function scheduleNext(delayMs) {
  clearTimer();
  setState({ nextRetryAt: state.status === 'offline' ? new Date(Date.now() + delayMs).toISOString() : null });
  timer = setTimeout(tick, delayMs);
}

async function tick() {
  timer = null;
  if (!running) return;
  await syncNow();
  if (!running) return;
  scheduleNext(delayFor(state));
}

/**
 * Starts background sync. Idempotent. The `intervalMs` argument is accepted for
 * compatibility and ignored: the cadence now follows the connection state.
 */
export function startAutoSync() {
  if (!running) {
    running = true;
    const onOnline = () => kickSync();
    const onOffline = () => { markOffline('Network connection lost.').then(() => scheduleNext(delayFor(state))); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    detachBrowserEvents = () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
    tick();
  }
  return () => stopAutoSync();
}

export function stopAutoSync() {
  running = false;
  clearTimer();
  if (detachBrowserEvents) detachBrowserEvents();
  detachBrowserEvents = null;
}

/** Runs a sync pass now and resets the retry schedule (after a queued change or a reconnect). */
export function kickSync() {
  if (!running) return syncNow();
  clearTimer();
  return tick();
}

// Initial badge count and last-synced time, so both are right before the first
// pass finishes (the last-synced time survives a restart via the cache).
refreshPendingCount().catch(() => {});
getCachedSyncedAt().then((t) => { if (t && !state.lastSyncAt) setState({ lastSyncAt: t }); }).catch(() => {});
