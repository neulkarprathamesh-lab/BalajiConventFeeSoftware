/**
 * Pure offline/sync rules, kept free of IndexedDB and network code so they can
 * be unit tested directly. syncEngine.js, api.js and App.js apply these rules.
 */

// Retry delays while the Main Server is unreachable. Each failed probe waits
// longer, capped at 30 s: the Client notices the server coming back within half
// a minute without polling it every few seconds.
export const BACKOFF_MS = [3000, 6000, 12000, 24000, 30000];

// While connected: heartbeat + push + pull cadence (pending work is pushed at once).
export const CONNECTED_POLL_MS = 30000;
// Reachable server but no valid sign-in (or revoked device): look again slowly.
export const SIGNIN_POLL_MS = 60000;

/** Delay before the next probe after `failures` consecutive failed probes (1-based). */
export function nextRetryDelayMs(failures) {
  const n = Math.max(1, Math.floor(Number(failures) || 1));
  return BACKOFF_MS[Math.min(n - 1, BACKOFF_MS.length - 1)];
}

/**
 * Which axios calls may run while the Main Server is unreachable.
 *  - GET: allowed. Served from the local cache where a cache exists (see
 *    cachedGetFor), otherwise it fails like any network call.
 *  - Login/logout: attempted normally; the offline sign-in path takes over on a
 *    network failure (AuthContext.login).
 *  - Every other write: refused before it leaves the PC. Offline CREATEs for
 *    receipts, expenses and bills go through the pending queue instead; all
 *    other writes are server-only in this version.
 */
const OFFLINE_EXEMPT_WRITES = ['/auth/login', '/auth/logout'];

export function isRequestAllowedOffline(method, url) {
  const m = String(method || 'get').toLowerCase();
  if (m === 'get' || m === 'head' || m === 'options') return true;
  const path = pathOf(url);
  return OFFLINE_EXEMPT_WRITES.some((p) => path === p || path.endsWith(p));
}

/**
 * Screens that need the Main Server and are not offered offline in this version.
 * The route key is the path after "/" in App.js. Each one is either an admin
 * or master-data-change screen (approved server-only list) or a screen with no
 * offline data behind it.
 */
export const SERVER_ONLY_ROUTES = new Set([
  'settings', 'admin', 'connected-pcs', 'config-io', 'factory-reset',
  'software-updates', 'backup-disaster-recovery', 'delivery-center',
  'config-snapshots', 'receipt-archives', 'setup-wizard', 'import-excel',
  'imports-history', 'assign-students', 'promotion', 'bulk-fee-update',
  'fee-structure', 'receipt-types', 'fee-edit-access-requests',
  'adjustments', 'fee-adjustment-applications', 'fee-adjustment-extension',
  'extensions', 'bus-stops', 'bus-fees', 'kiosk-poster',
]);

export function isServerOnlyRoute(routeKey) {
  return SERVER_ONLY_ROUTES.has(String(routeKey || '').replace(/^\/+/, '').split('/')[0]);
}

export function pathOf(url) {
  return String(url || '').split('?')[0].replace(/\/+$/, '');
}

/**
 * Serves a GET from the last-synced snapshot. Returns { found, data }.
 * `snapshot` = { students, fee_structures, departments, classes, receipt_types,
 * settings, bus_routes } (each an array or object, possibly empty).
 */
export function cachedGetFor(url, params, snapshot) {
  const path = pathOf(url);
  const p = params || {};
  const snap = snapshot || {};
  const students = snap.students || [];

  if (path === '/students') {
    const needle = String(p.q || '').trim().toLowerCase();
    const rows = students.filter((s) => {
      if (p.class_id && s.class_id !== p.class_id) return false;
      if (p.department_id && s.department_id !== p.department_id) return false;
      if (!needle) return true;
      return (s.name || '').toLowerCase().includes(needle) || (s.admission_no || '').toLowerCase().includes(needle);
    });
    return { found: true, data: rows };
  }

  const student = path.match(/^\/students\/([^/]+)$/);
  if (student) {
    const row = students.find((s) => s.id === student[1]);
    return row ? { found: true, data: row } : { found: false };
  }

  const ledger = path.match(/^\/students\/([^/]+)\/ledger$/);
  if (ledger) {
    const row = students.find((s) => s.id === ledger[1]);
    if (!row) return { found: false };
    // Same shape NewReceipt builds for its offline fallback. Receipts,
    // adjustments and siblings are not in the snapshot, so they are empty.
    return {
      found: true,
      data: {
        student: row, fee_structure: null, receipts: [], adjustments: [],
        fee_items: row.fee_items || [], bus_charges: row.bus_charges || [],
        bus_outstanding: row.bus_outstanding || 0,
        total_paid: row.total_paid || 0, school_outstanding: row.school_outstanding || 0,
        outstanding: (row.school_outstanding || 0) + (row.bus_outstanding || 0),
      },
    };
  }

  const simple = {
    '/fee-structures': snap.fee_structures,
    '/departments': snap.departments,
    '/classes': snap.classes,
    '/receipt-types': snap.receipt_types,
    '/bus-routes': snap.bus_routes,
    '/settings': snap.settings,
  };
  if (Object.prototype.hasOwnProperty.call(simple, path) && simple[path] !== undefined) {
    return { found: true, data: simple[path] };
  }
  return { found: false };
}

/** Counts for the status badge. "waiting" = queued and not yet confirmed by the server. */
export function summarizeOps(ops) {
  const list = ops || [];
  const pending = list.filter((o) => o.status === 'pending').length;
  const failed = list.filter((o) => o.status === 'failed').length;
  return { pending, failed, waiting: pending + failed };
}

/**
 * Human label for "last synced": "just now", "5 min ago", "2 h ago", or a
 * date/time in school time (Asia/Kolkata) once it is older than a day.
 */
export function syncedAgoLabel(iso, now = Date.now()) {
  if (!iso) return 'not synced yet';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'not synced yet';
  const diffS = Math.max(0, Math.floor((now - t) / 1000));
  if (diffS < 60) return 'just now';
  if (diffS < 3600) return `${Math.floor(diffS / 60)} min ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)} h ago`;
  return new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

const WAITING_WORD = (n) => `${n} change${n === 1 ? '' : 's'}`;

/**
 * Words and colour for the connection badge. `s` is the engine state (see
 * syncEngine.getState). Returns { tone, title, detail }.
 *   connected     -> Connected / Synced just now
 *   syncing       -> Syncing / N pending changes
 *   offline       -> Offline / Server unavailable / N changes waiting
 *   auth_required -> Sign in to sync / N changes waiting
 *   error         -> Sync problem / reason
 */
export function describeStatus(s, now = Date.now()) {
  const waiting = (s && (s.pendingCount || 0)) || 0;
  switch (s && s.status) {
    case 'connected':
      return { tone: 'green', title: 'Connected', detail: `Synced ${syncedAgoLabel(s.lastSyncAt, now)}` };
    case 'syncing':
      return { tone: 'amber', title: 'Syncing', detail: waiting ? `${WAITING_WORD(waiting)} pending` : 'Exchanging data with the Main Server' };
    case 'offline':
      return { tone: 'red', title: 'Offline', detail: waiting ? `Server unavailable · ${WAITING_WORD(waiting)} waiting` : 'Server unavailable · Local mode' };
    case 'auth_required':
      return { tone: 'amber', title: 'Sign in to sync', detail: waiting ? `${WAITING_WORD(waiting)} waiting for a sign-in` : 'Server reachable' };
    case 'error':
      return { tone: 'red', title: 'Sync problem', detail: (s && s.lastError) || 'Sync stopped - see the diagnostic report' };
    default:
      return { tone: 'slate', title: 'Connecting', detail: 'Checking the Main Server' };
  }
}
