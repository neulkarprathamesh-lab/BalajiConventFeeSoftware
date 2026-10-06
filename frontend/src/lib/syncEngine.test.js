import * as engine from './syncEngine';
import { openDb, idbGetAll, STORE_OPS, STORE_CACHE } from './offlineDb';

// A tiny stand-in for the Main Server. `handler(path, init)` returns a
// { status, body } pair, or the string 'DOWN' to simulate the server being
// switched off (the browser sees a network error, not an HTTP status).
function serverWith(handler) {
  global.fetch = jest.fn(async (url, init) => {
    const path = new URL(url).pathname;
    const out = handler(path, init || {}, url);
    if (out === 'DOWN') throw new TypeError('Failed to fetch');
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      json: async () => out.body,
    };
  });
  return global.fetch;
}

const UP = (extra = {}) => (path, init) => {
  if (path === '/api/version') return { status: 200, body: { version: '1.1.0' } };
  if (path === '/api/devices/heartbeat') return { status: 200, body: { device_id: 'd' } };
  if (path === '/api/sync/push') {
    const body = JSON.parse(init.body);
    return { status: 200, body: { results: body.operations.map((o) => ({ local_id: o.local_id, status: 'applied', result: { receipt_number: 'JC-2026-000100' }, error: null })) } };
  }
  if (path === '/api/sync/pull') {
    return { status: 200, body: { synced_at: '2026-10-06T10:00:00+00:00', students: [{ id: 's1', name: 'Asha Patil', admission_no: '1001' }], fee_structures: [], departments: [], classes: [], receipt_types: [], settings: {}, bus_routes: [{ id: 'b1', code: 'N426' }], ...extra } };
  }
  return { status: 404, body: {} };
};

async function clearStores() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_OPS, STORE_CACHE], 'readwrite');
    tx.objectStore(STORE_OPS).clear();
    tx.objectStore(STORE_CACHE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Queueing kicks a background pass; let it finish before the test looks at state.
async function settle() {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 2));
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('bc_token', 'signed-in-token');
  await clearStores();
  await engine.syncNow().catch(() => {});
});

const receiptPayload = { student_id: 's1', amount: 1200, mode: 'cash' };

describe('server OFF', () => {
  test('the client goes Offline without an error and keeps working locally', async () => {
    serverWith(() => 'DOWN');
    const state = await engine.syncNow();
    expect(state.status).toBe('offline');
    expect(state.online).toBe(false);
    expect(state.failures).toBeGreaterThan(0);
    expect(state.lastError).toMatch(/did not respond/i);
  });

  test('a receipt entered while offline is queued, not lost', async () => {
    serverWith(() => 'DOWN');
    await engine.syncNow();
    const op = await engine.queueOperation('create_receipt', receiptPayload);
    await settle();
    const rows = await idbGetAll(STORE_OPS);
    expect(rows).toHaveLength(1);
    expect(rows[0].local_id).toBe(op.local_id);
    expect(rows[0].status).toBe('pending');
    expect(engine.getState().pendingCount).toBe(1);
  });

  test('expenses and bills queue the same way', async () => {
    serverWith(() => 'DOWN');
    await engine.syncNow();
    await engine.queueOperation('create_expense', { amount: 300 });
    await engine.queueOperation('create_bill', { amount: 80 });
    await settle();
    const types = (await idbGetAll(STORE_OPS)).map((o) => o.op_type).sort();
    expect(types).toEqual(['create_bill', 'create_expense']);
  });

  test('cached students and master data are still readable', async () => {
    serverWith(UP());
    await engine.syncNow();
    serverWith(() => 'DOWN');
    await engine.syncNow();
    expect(await engine.getCachedStudents()).toEqual([{ id: 's1', name: 'Asha Patil', admission_no: '1001' }]);
    expect((await engine.readCachedGet('/students', { q: 'asha' })).found).toBe(true);
    expect((await engine.readCachedGet('/bus-routes', {})).data).toEqual([{ id: 'b1', code: 'N426' }]);
  });
});

describe('duplicate protection', () => {
  test('the same form submission queued twice creates one queued record', async () => {
    serverWith(() => 'DOWN');
    const a = await engine.queueOperation('create_receipt', receiptPayload, { dedupeKey: 'form-42' });
    const b = await engine.queueOperation('create_receipt', receiptPayload, { dedupeKey: 'form-42' });
    await settle();
    expect(b.local_id).toBe(a.local_id);
    expect(await idbGetAll(STORE_OPS)).toHaveLength(1);
  });

  test('the same payment queued again while still waiting is not added twice', async () => {
    serverWith(() => 'DOWN');
    const first = await engine.queueOperation('create_receipt', { student_id: 's1', amount: 500, mode: 'cash', lines: [{ amount: 500 }] });
    const again = await engine.queueOperation('create_receipt', { mode: 'cash', amount: 500, lines: [{ amount: 500 }], student_id: 's1' });
    await settle();
    expect(again.duplicate).toBe(true);
    expect(again.local_id).toBe(first.local_id);
    expect(await idbGetAll(STORE_OPS)).toHaveLength(1);
  });

  test('a different amount for the same student is a different payment', async () => {
    serverWith(() => 'DOWN');
    await engine.queueOperation('create_receipt', { student_id: 's1', amount: 500, mode: 'cash', lines: [{ amount: 500 }] });
    const other = await engine.queueOperation('create_receipt', { student_id: 's1', amount: 700, mode: 'cash', lines: [{ amount: 700 }] });
    await settle();
    expect(other.duplicate).toBeUndefined();
    expect(await idbGetAll(STORE_OPS)).toHaveLength(2);
  });

  test('once the server has confirmed a payment, the same content may be queued again', async () => {
    const body = { student_id: 's1', amount: 900, mode: 'upi', lines: [{ amount: 900 }] };
    serverWith(() => 'DOWN');
    await engine.queueOperation('create_receipt', body);
    await settle();
    serverWith(UP());
    await engine.syncNow();
    expect(await idbGetAll(STORE_OPS)).toHaveLength(0);
    serverWith(() => 'DOWN');
    const later = await engine.queueOperation('create_receipt', body);
    expect(later.duplicate).toBeUndefined();
  });

  test('two separate submissions (different keys) are two receipts', async () => {
    serverWith(() => 'DOWN');
    await engine.queueOperation('create_receipt', receiptPayload, { dedupeKey: 'form-1' });
    await engine.queueOperation('create_receipt', receiptPayload, { dedupeKey: 'form-2' });
    await settle();
    expect(await idbGetAll(STORE_OPS)).toHaveLength(2);
  });

  test('concurrent queueing with one key still stores a single record', async () => {
    serverWith(() => 'DOWN');
    await Promise.all([1, 2, 3].map(() => engine.queueOperation('create_receipt', receiptPayload, { dedupeKey: 'same' })));
    await settle();
    expect(await idbGetAll(STORE_OPS)).toHaveLength(1);
  });

  test('a retry after a dropped connection re-sends the SAME local_id (server applies it once)', async () => {
    const sentIds = [];
    serverWith((path, init) => {
      if (path === '/api/sync/push') {
        sentIds.push(...JSON.parse(init.body).operations.map((o) => o.local_id));
        return 'DOWN'; // connection drops after the request was sent
      }
      return UP()(path, init);
    });
    const op = await engine.queueOperation('create_receipt', receiptPayload);
    await settle();
    await engine.syncNow();
    expect(sentIds.length).toBeGreaterThan(0);
    expect(new Set(sentIds)).toEqual(new Set([op.local_id]));
  });
});

describe('server returns', () => {
  test('pending operations are pushed, applied, and the queue empties', async () => {
    serverWith(() => 'DOWN');
    await engine.syncNow();
    const op = await engine.queueOperation('create_receipt', receiptPayload);
    await settle();
    expect(engine.getState().pendingCount).toBe(1);

    serverWith(UP());
    const state = await engine.syncNow();
    expect(state.status).toBe('connected');
    expect(state.online).toBe(true);
    expect(state.pendingCount).toBe(0);
    expect(state.lastSyncAt).toBeTruthy();
    expect(await idbGetAll(STORE_OPS)).toHaveLength(0);
    expect(op.local_id).toBeTruthy();
  });

  test('server changes are pulled into the cache at the same time', async () => {
    serverWith(() => 'DOWN');
    await engine.syncNow();
    serverWith(UP({ students: [{ id: 's9', name: 'New Admission', admission_no: '2001' }] }));
    await engine.syncNow();
    expect((await engine.getCachedStudents()).map((s) => s.id)).toEqual(['s9']);
  });

  test('a rejected receipt stays queued and is counted for attention, not silently dropped', async () => {
    serverWith(() => 'DOWN');
    await engine.syncNow();
    await engine.queueOperation('create_receipt', receiptPayload);
    await settle();

    serverWith((path, init) => {
      if (path === '/api/sync/push') {
        const body = JSON.parse(init.body);
        return { status: 200, body: { results: body.operations.map((o) => ({ local_id: o.local_id, status: 'failed', result: null, error: 'Fee already paid' })) } };
      }
      return UP()(path, init);
    });
    const state = await engine.syncNow();
    expect(state.status).toBe('connected');
    expect(state.failedCount).toBe(1);
    expect(state.pendingCount).toBe(1);
    const [row] = await idbGetAll(STORE_OPS);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('Fee already paid');
  });

  test('a burst of server checks while down shares one pass at a time', async () => {
    const f = serverWith(() => 'DOWN');
    await Promise.all([engine.syncNow(), engine.syncNow(), engine.syncNow()]);
    const versionCalls = f.mock.calls.filter(([u]) => String(u).endsWith('/api/version')).length;
    expect(versionCalls).toBe(1);
  });
});

describe('authentication and revocation', () => {
  test('no sign-in on this PC: reachable server, status asks for a sign-in, queue kept', async () => {
    localStorage.removeItem('bc_token');
    serverWith(UP());
    await engine.queueOperation('create_receipt', receiptPayload, { dedupeKey: 'x' }).catch(() => {});
    const state = await engine.syncNow();
    expect(state.status).toBe('auth_required');
    expect(state.online).toBe(true);
  });

  test('sign-in expired while offline: status asks to sign in again and nothing is lost', async () => {
    serverWith(() => 'DOWN');
    await engine.syncNow();
    await engine.queueOperation('create_receipt', receiptPayload);
    await settle();
    serverWith((path) => (path === '/api/devices/heartbeat' ? { status: 401, body: { detail: 'Token expired' } } : UP()(path)));
    const state = await engine.syncNow();
    expect(state.status).toBe('auth_required');
    expect(state.pendingCount).toBe(1);
  });

  test('a revoked PC forgets its id so it can register again', async () => {
    localStorage.setItem('feehub_device_id', 'old-device');
    serverWith((path) => (path === '/api/devices/heartbeat' ? { status: 403, body: { detail: 'revoked' } } : UP()(path)));
    const state = await engine.syncNow();
    expect(state.status).toBe('error');
    expect(localStorage.getItem('feehub_device_id')).toBeNull();
  });

  test('a rejected device password is left for an administrator, not bypassed', async () => {
    localStorage.setItem('feehub_device_id', 'kept-device');
    serverWith((path) => (path === '/api/devices/heartbeat' ? { status: 401, body: { detail: 'Invalid or missing device credential.' } } : UP()(path)));
    const state = await engine.syncNow();
    expect(state.status).toBe('error');
    expect(state.lastError).toMatch(/administrator/i);
    expect(localStorage.getItem('feehub_device_id')).toBe('kept-device');
  });
});

describe('connection status', () => {
  test('the device id is created once and kept across restarts', () => {
    const first = engine.getDeviceId();
    expect(engine.getDeviceId()).toBe(first);
  });

  test('state updates reach subscribers', async () => {
    const seen = [];
    const unsub = engine.subscribe((s) => seen.push(s.status));
    serverWith(() => 'DOWN');
    await engine.syncNow();
    unsub();
    expect(seen).toContain('offline');
  });
});
