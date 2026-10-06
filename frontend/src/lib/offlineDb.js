/**
 * The one IndexedDB database used by the offline client ('feehub_offline').
 *
 * Stores:
 *   pending_ops  - queued offline CREATE operations (receipts, expenses, bills).
 *                  keyPath local_id. Retried with the SAME local_id, so the server
 *                  can never create one of them twice (sync_operations unique index).
 *   cache        - last-synced master data (students, fee structures, classes, bus
 *                  routes, settings...). keyPath key.
 *   auth         - offline sign-in verifiers, one per user (keyPath email). Holds a
 *                  PBKDF2 hash of the password, never the password. See offlineAuth.js.
 *
 * Version history:
 *   1 - pending_ops, cache
 *   2 - adds auth (the upgrade only creates missing stores; existing data is kept)
 */
export const DB_NAME = 'feehub_offline';
export const DB_VERSION = 2;
export const STORE_OPS = 'pending_ops';
export const STORE_CACHE = 'cache';
export const STORE_AUTH = 'auth';

let dbPromise = null;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_OPS)) db.createObjectStore(STORE_OPS, { keyPath: 'local_id' });
        if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_AUTH)) db.createObjectStore(STORE_AUTH, { keyPath: 'email' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

/** Test helper: forget the cached connection so a fresh database can be opened. */
export function resetDbForTests() {
  dbPromise = null;
}

export async function idbGetAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
