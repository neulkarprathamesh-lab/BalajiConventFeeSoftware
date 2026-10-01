import { API_BASE } from './api';

/**
 * Offline-first sync engine for Client/Cashier PCs.
 *
 * Design mirrors the backend (see backend/routers/sync.py):
 *  - device_id is a UUID generated ONCE and persisted in localStorage - stable
 *    across renames, restarts, and different logged-in users on the same PC.
 *  - When ONLINE, existing screens are completely unaffected - they keep
 *    calling the real API exactly as before. This engine only takes over
 *    for the specific offline-capable actions (student search/fee lookup via
 *    the local cache, receipt creation via the pending queue) when the
 *    connectivity check has actually failed.
 *  - Every queued operation gets a fresh, random `local_id`. Retrying a push
 *    with the same local_id can NEVER create a duplicate receipt - the
 *    server's `sync_operations.local_id` unique index guarantees that
 *    server-side; this engine just makes sure it never invents a new
 *    local_id for an operation it already has queued.
 *  - Connectivity is checked with the existing cheap, no-auth GET /api/version
 *    endpoint - not a new heavyweight probe - on a sensible interval (default
 *    20s), never aggressively.
 */

const DB_NAME = 'feehub_offline';
const DB_VERSION = 1;
const STORE_OPS = 'pending_ops';
const STORE_CACHE = 'cache';
const DEVICE_ID_KEY = 'feehub_device_id';
const DEVICE_SECRET_KEY = 'feehub_device_secret';
const TOKEN_KEY = 'bc_token';

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
// Only required once an administrator has explicitly assigned one for THIS
// device_id - every device that never had one set keeps working exactly as
// before (no header sent at all).
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

function openDb() {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OPS)) db.createObjectStore(STORE_OPS, { keyPath: 'local_id' });
      if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------- Pub/sub for UI status ----------------
const listeners = new Set();
let state = {
  status: navigator.onLine ? 'connecting' : 'offline', // connecting|online|offline|syncing|error
  lastSyncAt: null,
  pendingCount: 0,
  lastError: null,
};

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((cb) => { try { cb(state); } catch (e) {} });
}

export function subscribe(cb) {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

export function getState() {
  return state;
}

// ---------------- Connectivity ----------------
export async function checkConnectivity(timeoutMs = 4000) {
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
export async function queueOperation(opType, payload) {
  const op = {
    local_id: uuid(), op_type: opType, payload,
    client_created_at: new Date().toISOString(), status: 'pending', retry_count: 0,
  };
  await idbPut(STORE_OPS, op);
  await refreshPendingCount();
  return op;
}

export async function getPendingOps() {
  return idbGetAll(STORE_OPS);
}

export async function refreshPendingCount() {
  const ops = await idbGetAll(STORE_OPS);
  setState({ pendingCount: ops.filter((o) => o.status !== 'applied').length });
  return state.pendingCount;
}

// ---------------- Local cache (for offline student search / fee lookup) ----------------
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

// Case-insensitive substring match on name/admission_no against the last
// synced student snapshot — the offline fallback for the live GET /students?q=
// search, used only once that live call has actually failed.
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

// ---------------- Sync ----------------
export async function syncNow() {
  if (state.status === 'syncing') return state;
  const deviceId = getDeviceId();
  setState({ status: 'syncing', lastError: null });

  const online = await checkConnectivity();
  if (!online) {
    setState({ status: 'offline' });
    return state;
  }

  try {
    // Heartbeat (cheap, tells Admin's Connected PCs this device is alive).
    const pending = await getPendingOps();
    const stillPending = pending.filter((o) => o.status !== 'applied');
    const heartbeatRes = await fetch(`${API_BASE}/api/devices/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(), ...deviceAuthHeaders() },
      body: JSON.stringify({ device_id: deviceId, app_version: '1.0.0', pending_count: stillPending.length }),
    });
    if (heartbeatRes.status === 403) {
      // The backend raises 403 from _check_device_auth for exactly one reason:
      // existing.revoked is true (see routers/sync.py). Its own design intent
      // is explicit: "cannot heartbeat/pull/push again until it registers
      // under a fresh device_id". Without this, a revoked installation gets
      // stuck retrying the same dead device_id forever - a permanent,
      // unrecoverable Sync Error that looks like a live production outage
      // even though every other device is syncing fine. Clearing the stored
      // id lets the very next tick self-heal via normal first-heartbeat
      // auto-registration; queued offline operations are keyed by their own
      // local_id in IndexedDB, independent of device_id, so nothing queued
      // is lost by this.
      localStorage.removeItem(DEVICE_ID_KEY);
      localStorage.removeItem(DEVICE_SECRET_KEY);
      setState({ status: 'error', lastError: 'This device was revoked by an administrator. Re-registering automatically...' });
      return state;
    }
    if (heartbeatRes.status === 401) {
      // Distinct from revoked: an admin-assigned device password was rejected.
      // Auto-generating a new device_id here would silently bypass that
      // password instead of fixing it, so this one surfaces for a human to
      // resolve (reset the device's password) rather than self-healing.
      setState({ status: 'error', lastError: 'This device\'s credential was rejected by the Main Server. Ask an administrator to reset its device password.' });
      return state;
    }

    // Push pending operations (each with its own stable local_id - safe to retry).
    if (stillPending.length) {
      const res = await fetch(`${API_BASE}/api/sync/push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(), ...deviceAuthHeaders() },
        body: JSON.stringify({ device_id: deviceId, operations: stillPending.map((o) => ({
          local_id: o.local_id, op_type: o.op_type, payload: o.payload, client_created_at: o.client_created_at,
        })) }),
      });
      if (res.ok) {
        const data = await res.json();
        for (const r of data.results) {
          if (r.status === 'applied') {
            const op = stillPending.find((o) => o.local_id === r.local_id);
            if (op) await idbPut(STORE_OPS, { ...op, status: 'applied', result: r.result });
          } else if (r.error) {
            const op = stillPending.find((o) => o.local_id === r.local_id);
            if (op) await idbPut(STORE_OPS, { ...op, status: 'failed', retry_count: (op.retry_count || 0) + 1, error: r.error });
          }
        }
      }
    }

    // Pull latest master data for offline fallback (students/fee_structures/etc).
    const pullRes = await fetch(`${API_BASE}/api/sync/pull?device_id=${encodeURIComponent(deviceId)}`, { headers: { ...authHeaders(), ...deviceAuthHeaders() } });
    if (pullRes.ok) {
      const data = await pullRes.json();
      await idbPut(STORE_CACHE, { key: 'students', value: data.students, synced_at: data.synced_at });
      await idbPut(STORE_CACHE, { key: 'fee_structures', value: data.fee_structures, synced_at: data.synced_at });
      await idbPut(STORE_CACHE, { key: 'departments', value: data.departments, synced_at: data.synced_at });
      await idbPut(STORE_CACHE, { key: 'classes', value: data.classes, synced_at: data.synced_at });
      await idbPut(STORE_CACHE, { key: 'receipt_types', value: data.receipt_types || [], synced_at: data.synced_at });
      await idbPut(STORE_CACHE, { key: 'settings', value: data.settings, synced_at: data.synced_at });
    }

    // Drop applied ops from the queue (their result stays inside sync history on
    // the server; nothing more to do locally once applied).
    const all = await idbGetAll(STORE_OPS);
    for (const o of all) {
      if (o.status === 'applied') await idbDelete(STORE_OPS, o.local_id);
    }
    await refreshPendingCount();
    setState({ status: 'online', lastSyncAt: new Date().toISOString() });
  } catch (e) {
    setState({ status: 'error', lastError: String(e) });
  }
  return state;
}

let autoTimer = null;
export function startAutoSync(intervalMs = 20000) {
  stopAutoSync();
  const tick = async () => {
    if (!localStorage.getItem(TOKEN_KEY)) return; // not logged in yet
    await syncNow();
  };
  tick();
  autoTimer = setInterval(tick, intervalMs);
  window.addEventListener('online', tick);
  return () => stopAutoSync();
}
export function stopAutoSync() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
}

// Kick off an initial pending-count read on module load so the badge is
// correct even before the first sync tick completes.
refreshPendingCount().catch(() => {});
