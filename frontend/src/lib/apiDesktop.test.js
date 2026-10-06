// The API client in the desktop client: writes are refused while the Main Server is
// unreachable, and reads fall back to the last synced snapshot. The network is stubbed
// so nothing here reaches a real server.
import { openDb, idbPut, STORE_CACHE } from './offlineDb';

const DESKTOP = {
  isDesktop: true,
  getConfig: () => ({
    appVersion: '1.1.0', serverHost: '192.168.0.116', serverPort: 8001,
    serverBase: 'http://192.168.0.116:8001', frontendBase: 'http://192.168.0.116:3000',
  }),
};

function networkDown(config) {
  const err = new Error('Network Error');
  err.code = 'ERR_NETWORK';
  err.config = config;
  return Promise.reject(err);
}

let api;
let engine;

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  window.feehubRuntime = DESKTOP;
  jest.resetModules();
  api = require('./api').default;
  engine = require('./syncEngine');
  api.defaults.adapter = networkDown;
  // Put a synced student in the cache, as a previous sync would have.
  await idbPut(STORE_CACHE, { key: 'students', value: [{ id: 's1', name: 'Asha Patil', admission_no: '1001' }], synced_at: '2026-10-06T09:00:00+00:00' });
  // The client is offline (no successful pass yet).
  expect(engine.isOnline()).toBe(false);
});

afterEach(() => { delete window.feehubRuntime; });

test('a server-only write is refused before it leaves the PC', async () => {
  let reached = false;
  api.defaults.adapter = (config) => { reached = true; return networkDown(config); };
  await expect(api.patch('/students/s1', { name: 'Changed' })).rejects.toMatchObject({ offlineBlocked: true });
  expect(reached).toBe(false);
});

test('a receipt POST while offline is refused with no HTTP response (the page then queues it)', async () => {
  const err = await api.post('/receipts', { student_id: 's1' }).catch((e) => e);
  expect(err.offlineBlocked).toBe(true);
  expect(err.response).toBeUndefined();
});

test('student search works offline from the cache', async () => {
  const res = await api.get('/students', { params: { q: 'asha' } });
  expect(res.fromCache).toBe(true);
  expect(res.data.map((s) => s.id)).toEqual(['s1']);
});

test('a student record opens offline from the cache', async () => {
  const res = await api.get('/students/s1');
  expect(res.data.name).toBe('Asha Patil');
});

test('a read with no cached copy still fails, so the screen shows the real error', async () => {
  await expect(api.get('/receipts')).rejects.toMatchObject({ code: 'ERR_NETWORK' });
});

test('sign-in is still attempted while offline (the offline sign-in path takes over)', async () => {
  let reached = false;
  api.defaults.adapter = (config) => { reached = true; return networkDown(config); };
  await expect(api.post('/auth/login', { email: 'a', password: 'b' })).rejects.toMatchObject({ code: 'ERR_NETWORK' });
  expect(reached).toBe(true);
});

test('the db module is available for the cache seed', async () => {
  const db = await openDb();
  expect(db.objectStoreNames.contains(STORE_CACHE)).toBe(true);
});
