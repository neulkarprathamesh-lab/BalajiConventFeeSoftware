import {
  nextRetryDelayMs, isRequestAllowedOffline, isServerOnlyRoute, SERVER_ONLY_ROUTES,
  cachedGetFor, summarizeOps, syncedAgoLabel, describeStatus, BACKOFF_MS,
} from './syncPolicy';

describe('retry backoff', () => {
  test('waits longer after each failed attempt, then stays at the 30 s cap', () => {
    expect([1, 2, 3, 4, 5].map(nextRetryDelayMs)).toEqual([3000, 6000, 12000, 24000, 30000]);
    expect(nextRetryDelayMs(9)).toBe(30000);
    expect(BACKOFF_MS[BACKOFF_MS.length - 1]).toBe(30000);
  });

  test('never polls faster than every 3 s, even for bad input', () => {
    expect(nextRetryDelayMs(0)).toBe(3000);
    expect(nextRetryDelayMs(undefined)).toBe(3000);
    expect(nextRetryDelayMs(-4)).toBe(3000);
  });
});

describe('offline request rule', () => {
  test('reads are allowed (served from cache when the server is down)', () => {
    expect(isRequestAllowedOffline('get', '/students')).toBe(true);
    expect(isRequestAllowedOffline('GET', '/students/abc/ledger')).toBe(true);
  });

  test('sign-in and sign-out are attempted normally', () => {
    expect(isRequestAllowedOffline('post', '/auth/login')).toBe(true);
    expect(isRequestAllowedOffline('post', '/auth/logout')).toBe(true);
  });

  test('every other write is refused offline - student edits, fee changes, bus master, users, PIN, devices', () => {
    expect(isRequestAllowedOffline('put', '/students/abc')).toBe(false);
    expect(isRequestAllowedOffline('patch', '/students/abc')).toBe(false);
    expect(isRequestAllowedOffline('post', '/students/abc/adjustments')).toBe(false);
    expect(isRequestAllowedOffline('post', '/fee-structures')).toBe(false);
    expect(isRequestAllowedOffline('post', '/bus-routes')).toBe(false);
    expect(isRequestAllowedOffline('post', '/users')).toBe(false);
    expect(isRequestAllowedOffline('post', '/devices/abc/set-password')).toBe(false);
    expect(isRequestAllowedOffline('delete', '/receipts/abc')).toBe(false);
  });
});

describe('server-only screens', () => {
  test('admin, settings and device screens need the server', () => {
    ['settings', 'admin', 'connected-pcs', 'fee-structure', 'receipt-types', 'adjustments', 'bus-fees'].forEach((k) => {
      expect(isServerOnlyRoute(k)).toBe(true);
    });
    expect(isServerOnlyRoute('/settings/anything')).toBe(true);
  });

  test('offline cashier screens stay open', () => {
    ['', 'students', 'new-receipt', 'expenses', 'bill-entry', 'receipts', 'bus-routes'].forEach((k) => {
      expect(isServerOnlyRoute(k)).toBe(false);
    });
  });

  test('the list is non-empty and holds only lowercase route keys', () => {
    expect(SERVER_ONLY_ROUTES.size).toBeGreaterThan(10);
    SERVER_ONLY_ROUTES.forEach((k) => expect(k).toMatch(/^[a-z-]+$/));
  });
});

describe('cached reads (server unreachable)', () => {
  const snapshot = {
    students: [
      { id: 's1', name: 'Asha Patil', admission_no: '1001', class_id: 'c9', fee_items: [{ head: 'Tuition', due: 1000, paid: 0 }], school_outstanding: 1000, bus_outstanding: 0, total_paid: 0 },
      { id: 's2', name: 'Ravi Kale', admission_no: '1002', class_id: 'c10', bus_required: true, school_outstanding: 0, bus_outstanding: 500, total_paid: 200 },
    ],
    fee_structures: [{ id: 'fs1' }],
    departments: [{ id: 'd1' }],
    classes: [{ id: 'c9' }],
    receipt_types: [{ id: 'rt1' }],
    settings: { school_name: 'Balaji' },
    bus_routes: [{ id: 'b1', code: 'N426' }],
  };

  test('student search matches name or admission number, case-insensitively', () => {
    expect(cachedGetFor('/students', { q: 'asha' }, snapshot).data.map((s) => s.id)).toEqual(['s1']);
    expect(cachedGetFor('/students', { q: '1002' }, snapshot).data.map((s) => s.id)).toEqual(['s2']);
    expect(cachedGetFor('/students', { q: 'nobody' }, snapshot).data).toEqual([]);
  });

  test('class filter narrows the list', () => {
    expect(cachedGetFor('/students', { class_id: 'c10' }, snapshot).data.map((s) => s.id)).toEqual(['s2']);
  });

  test('one student by id, with the fee position from the last sync', () => {
    const res = cachedGetFor('/students/s1', {}, snapshot);
    expect(res.found).toBe(true);
    expect(res.data.name).toBe('Asha Patil');
  });

  test('the fee ledger is rebuilt from the cached position, with no invented receipts', () => {
    const res = cachedGetFor('/students/s2/ledger', {}, snapshot);
    expect(res.found).toBe(true);
    expect(res.data.receipts).toEqual([]);
    expect(res.data.bus_outstanding).toBe(500);
    expect(res.data.outstanding).toBe(500);
  });

  test('master data and the bus master are readable offline', () => {
    expect(cachedGetFor('/fee-structures', {}, snapshot).data).toEqual([{ id: 'fs1' }]);
    expect(cachedGetFor('/classes', {}, snapshot).data).toEqual([{ id: 'c9' }]);
    expect(cachedGetFor('/bus-routes', {}, snapshot).data).toEqual([{ id: 'b1', code: 'N426' }]);
  });

  test('anything not in the snapshot is reported as not found, never guessed', () => {
    expect(cachedGetFor('/students/unknown', {}, snapshot).found).toBe(false);
    expect(cachedGetFor('/receipts', {}, snapshot).found).toBe(false);
    expect(cachedGetFor('/students/s1/siblings', {}, snapshot).found).toBe(false);
  });
});

describe('queue summary', () => {
  test('pending and failed are counted separately; applied rows are not waiting', () => {
    const counts = summarizeOps([
      { status: 'pending' }, { status: 'pending' }, { status: 'failed' }, { status: 'applied' },
    ]);
    expect(counts).toEqual({ pending: 2, failed: 1, waiting: 3 });
  });
});

describe('last synced label', () => {
  const now = Date.parse('2026-10-06T10:00:00Z');
  test('recent syncs read as just now, then in minutes and hours', () => {
    expect(syncedAgoLabel(new Date(now - 20 * 1000).toISOString(), now)).toBe('just now');
    expect(syncedAgoLabel(new Date(now - 5 * 60 * 1000).toISOString(), now)).toBe('5 min ago');
    expect(syncedAgoLabel(new Date(now - 2 * 3600 * 1000).toISOString(), now)).toBe('2 h ago');
  });
  test('never synced, or an unreadable time, is not an invented time', () => {
    expect(syncedAgoLabel(null, now)).toBe('not synced yet');
    expect(syncedAgoLabel('garbage', now)).toBe('not synced yet');
  });
});

describe('status wording', () => {
  const now = Date.parse('2026-10-06T10:00:00Z');
  test('Connected shows when the last sync ran', () => {
    expect(describeStatus({ status: 'connected', lastSyncAt: new Date(now - 10000).toISOString() }, now))
      .toEqual({ tone: 'green', title: 'Connected', detail: 'Synced just now' });
  });
  test('Syncing shows the pending count', () => {
    expect(describeStatus({ status: 'syncing', pendingCount: 3 }, now).detail).toBe('3 changes pending');
    expect(describeStatus({ status: 'syncing', pendingCount: 1 }, now).detail).toBe('1 change pending');
  });
  test('Offline says the server is unavailable and how many changes wait', () => {
    expect(describeStatus({ status: 'offline', pendingCount: 3 }, now)).toEqual({
      tone: 'red', title: 'Offline', detail: 'Server unavailable · 3 changes waiting',
    });
    expect(describeStatus({ status: 'offline', pendingCount: 0 }, now).detail).toBe('Server unavailable · Local mode');
  });
  test('Sign in to sync and Sync problem', () => {
    expect(describeStatus({ status: 'auth_required', pendingCount: 2 }, now).title).toBe('Sign in to sync');
    expect(describeStatus({ status: 'error', lastError: 'Revoked' }, now).detail).toBe('Revoked');
  });
});
