/**
 * Balaji FeeHub - Electron main process (offline-first client)
 *
 * The application UI is BUNDLED inside this package (renderer/app/, built from
 * frontend/ with REACT_APP_DESKTOP=1). It always opens from the local bundle,
 * whether or not the Main Server is running:
 *
 *   BalajiFeeHub.exe -> bundled UI -> local store (IndexedDB) -> sync engine
 *                                                              \-> Main Server
 *                                                                  (when reachable)
 *
 * The Main Server address comes from %APPDATA%\BalajiFeeHub\config.json
 * (default 192.168.0.116:8001) and is changed in File > Server Settings. It is
 * never hard-coded here. See config-store.js.
 *
 * MongoDB stays on the Main Server. Clients only ever talk to the backend on
 * the configured port (8001 by default) - never to Mongo directly.
 */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const { execFile } = require('child_process');
const updater = require('./updater/updater');
const clientUpdate = require('./updater/client-update');
const serverConfig = require('./config-store');

// -----------------------------------------------------------------------------
// In-memory log ring buffer, for the diagnostic report ("Application logs").
// Not written to disk continuously - only captured into a report on demand,
// so there's no persistent log file to manage/rotate.
// -----------------------------------------------------------------------------
const LOG_BUFFER_MAX = 300;
const logBuffer = [];
function bufferLog(level, args) {
  try {
    const line = `[${new Date().toISOString()}] [${level}] ` + args.map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
      return String(a);
    }).join(' ');
    logBuffer.push(line);
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  } catch (_) { /* never let logging itself throw */ }
}
['log', 'info', 'warn', 'error'].forEach((level) => {
  const orig = console[level].bind(console);
  console[level] = (...args) => { bufferLog(level, args); orig(...args); };
});

// -----------------------------------------------------------------------------
// Server address - AppData config (see config-store.js). Read on every use so
// a change made in File > Server Settings is picked up without a restart.
// Never hard-coded: the default 192.168.0.116:8001 is supplied by config-store.
// -----------------------------------------------------------------------------
const CONFIG_PATHS = serverConfig.configPaths(app.getPath('appData'), process.env.BALAJI_FEEHUB_CONFIG_DIR || null);
const CONFIG_DIR = CONFIG_PATHS.dir;
const CONFIG_FILE = CONFIG_PATHS.file;
const PROBE_TIMEOUT_MS = 800;
const MANUAL_TIMEOUT_MS = 5000;

function readConfig() {
  return serverConfig.readConfigFile(CONFIG_FILE);
}
function writeConfig(patch) {
  try {
    return serverConfig.writeConfigFile(CONFIG_FILE, patch);
  } catch (err) {
    console.error('Failed to write config:', err);
    return readConfig();
  }
}
function currentServerHost() {
  return readConfig().serverHost;
}
function currentServerAuthority() {
  const c = readConfig();
  return `${c.serverHost}:${c.serverPort}`;
}

// -----------------------------------------------------------------------------
// Server probing (status check only - the UI itself is never loaded from the
// server, so a probe result never decides whether the app can open).
// -----------------------------------------------------------------------------
function probeServer(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const options = { host, port, path: '/api/version', timeout: timeoutMs };
    const req = http.get(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; if (body.length > 4096) { req.destroy(); } });
      res.on('end', () => {
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function getLocalSubnets() {
  const subnets = new Set();
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}.`);
      }
    }
  }
  return Array.from(subnets);
}

// -----------------------------------------------------------------------------
// Diagnostics ("Create Diagnostic Report") - never includes passwords, JWTs,
// API keys, or database credentials; only connectivity facts + non-secret
// config (server IP, timestamps) + recent log lines.
// -----------------------------------------------------------------------------
function tcpPortTest(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok, detail) => { if (done) return; done = true; socket.destroy(); resolve({ ok, detail }); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (err) => finish(false, err.code || err.message));
    socket.connect(port, host);
  });
}

function pingHost(host) {
  return new Promise((resolve) => {
    execFile('ping', ['-n', '1', '-w', '1500', host], { timeout: 5000 }, (err, stdout) => {
      const out = (stdout || (err && err.message) || '').trim();
      resolve({ ok: !err && /TTL=/i.test(out), output: out.slice(0, 500) });
    });
  });
}

function httpVersionTest(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/api/version', timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 2048) req.destroy(); });
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: body.slice(0, 500) }));
    });
    req.on('error', (err) => resolve({ ok: false, error: err.code || err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

async function gatherDiagnostics(targetIp) {
  const cfgNow = readConfig();
  const host = targetIp || cfgNow.serverHost || null;
  const backendPort = cfgNow.serverPort;
  const frontendPort = serverConfig.FRONTEND_PORT;
  const lines = [];
  const push = (s = '') => lines.push(s);

  push('BALAJI FEEHUB CLIENT DIAGNOSTIC REPORT');
  push('='.repeat(60));
  push(`Generated at       : ${new Date().toISOString()}`);
  push('');
  push('-- System --');
  push(`Windows            : ${os.type()} ${os.release()}${typeof os.version === 'function' ? ' (' + os.version() + ')' : ''}`);
  push(`Architecture       : ${os.arch()}`);
  push(`Hostname           : ${os.hostname()}`);
  push('');
  push('-- Application --');
  push(`App version        : ${updater.readInstalledVersion()}`);
  push(`Install path       : ${path.dirname(process.execPath)}`);
  push(`Config file        : ${CONFIG_FILE}`);
  push(`Electron           : ${process.versions.electron}`);
  push(`Chromium           : ${process.versions.chrome}`);
  push(`Node.js            : ${process.versions.node}`);
  push('');
  push('-- Local network interfaces --');
  const subnets = getLocalSubnets();
  push(subnets.length ? subnets.map((s) => `${s}0/24`).join(', ') : '(none detected)');
  push('');
  push('-- Main Server target --');
  push(`Address being used : ${host || '(none configured / not yet connected)'}`);

  if (host) {
    push('');
    push('-- Connectivity tests --');
    const ping = await pingHost(host);
    push(`Ping               : ${ping.ok ? 'OK' : 'FAILED'}`);
    if (ping.output) push('  ' + ping.output.replace(/\n/g, '\n  '));

    const port3000 = await tcpPortTest(host, frontendPort, 2000);
    push(`Port 3000 (frontend): ${port3000.ok ? 'OK - reachable' : 'FAILED - ' + port3000.detail}`);

    const port8001 = await tcpPortTest(host, backendPort, 2000);
    push(`Port 8001 (backend) : ${port8001.ok ? 'OK - reachable' : 'FAILED - ' + port8001.detail}`);

    const apiVer = await httpVersionTest(host, backendPort, 3000);
    push(`GET /api/version   : ${apiVer.ok ? `OK - HTTP ${apiVer.status}` : `FAILED - ${apiVer.error || 'HTTP ' + apiVer.status}`}`);
    if (apiVer.body) push(`  Response: ${apiVer.body}`);

    push('');
    push('-- Likely cause --');
    if (!ping.ok) {
      push('Ping failed: this PC cannot reach that address at all. Check that both PCs are');
      push('on the same LAN/subnet, the Main Server PC is powered on, and the IP is correct.');
    } else if (!port3000.ok && !port8001.ok) {
      push('Ping succeeded but BOTH ports are unreachable while the host responds to ping.');
      push('This is the classic signature of Windows Firewall blocking inbound connections');
      push('on the Main Server PC. On the MAIN SERVER, check Windows Defender Firewall >');
      push('Allowed apps for BalajiFeeHub-Backend / BalajiFeeHub-Frontend (ports 8001/3000).');
    } else if (port3000.ok && !port8001.ok) {
      push('Frontend (3000) is reachable but backend (8001) is not. The BalajiFeeHub-Backend');
      push('service on the Main Server may be stopped, or a firewall rule only allows 3000.');
    } else if (port8001.ok && !apiVer.ok) {
      push('Port 8001 is open but /api/version did not return HTTP 200. The backend process');
      push('may be starting up, crashing, or a different service is bound to that port.');
    } else if (apiVer.ok) {
      push('All connectivity tests passed - the Main Server is reachable and responding');
      push('correctly. If login still fails, the problem is most likely account credentials,');
      push('not connectivity.');
    }
  } else {
    push('(No Main Server address has been entered or discovered yet - connectivity tests skipped.)');
  }

  push('');
  push('-- Recent application log (this session) --');
  push(logBuffer.length ? logBuffer.join('\n') : '(no log lines captured yet)');
  push('');
  push('NOTE: This report never contains passwords, tokens, API keys, or database credentials.');

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Stale-cache defense
// -----------------------------------------------------------------------------
// serve_frontend.py (installer-side) now sends correct Cache-Control headers,
// so going forward Chromium will always revalidate the app shell over the
// network. But Electron's HTTP disk cache is PERSISTENT across app restarts
// (stored under %APPDATA%\<productName>\..., independent of the Program
// Files install directory that installers/repairs/updates manage), so any
// client that already cached an old app shell before this fix shipped could
// otherwise keep serving it forever. Defense in depth: whenever the
// installed app version changes, force-clear the Chromium cache exactly
// once before the first navigation of that version.
async function clearCacheIfVersionChanged() {
  try {
    const installedVersion = updater.readInstalledVersion();
    const cfg = readConfig();
    if (cfg.lastCacheClearedForVersion === installedVersion) return;
    await mainWindow.webContents.session.clearCache();
    // Best-effort - not all storage types are relevant here, but this is
    // cheap insurance against any other cached response for the app origin.
    try {
      await mainWindow.webContents.session.clearStorageData({ storages: ['cachestorage'] });
    } catch (_) { /* not fatal - clearCache() above already covers HTTP cache */ }
    writeConfig({ ...cfg, lastCacheClearedForVersion: installedVersion });
    console.log(`[BalajiFeeHub] Cleared Chromium cache for version ${installedVersion} (stale-frontend defense).`);
  } catch (err) {
    console.error('[BalajiFeeHub] Cache-clear check failed (non-fatal):', err);
  }
}

// -----------------------------------------------------------------------------
// Window management
// -----------------------------------------------------------------------------
let mainWindow = null;

// The window always opens the BUNDLED UI (renderer/app/index.html). Nothing in
// this section depends on the Main Server being reachable at launch.
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Balaji FeeHub',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Auto-open devtools if user launches with --debug or sets BALAJI_DEBUG=1.
  // Also always accessible via Ctrl+Shift+I. Diagnostics are also embedded in
  // the login page itself for users who cannot use devtools.
  const debugMode = process.argv.includes('--debug') || process.env.BALAJI_DEBUG === '1';
  if (debugMode) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  // Ctrl+Shift+I / F12 to toggle devtools (kept even without --debug).
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Start maximized every launch. maximize() before show() so the window is
  // never briefly visible at its small default size first.
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  // Links to the school web pages on the Main Server may open in a window;
  // anything else leaves for the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const cfg = readConfig();
    const allowed = [serverConfig.serverBase(cfg), serverConfig.frontendBase(cfg)];
    if (/^https?:\/\//i.test(url) && !allowed.some((base) => url === base || url.startsWith(base + '/'))) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // A failed load of the bundled UI itself is a packaging fault, not a server
  // problem - log it so it shows up in the diagnostic report.
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL) => {
    console.error(`Bundled UI failed to load (${errorCode} ${errorDesc}) ${validatedURL || ''}`);
  });

  buildMenu();
  loadBundledApp();
}

// -----------------------------------------------------------------------------
// Startup: open the bundled UI. The Main Server is NOT contacted here - the
// renderer's sync engine connects in the background and reports the status.
// -----------------------------------------------------------------------------
function loadBundledApp() {
  clearCacheIfVersionChanged().finally(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'app', 'index.html'));
  });
}

// Runtime facts the bundled UI needs before it can talk to the server. Read
// synchronously by preload.js (ipcRenderer.sendSync) so the API base is known
// before the first request is made.
function runtimeSnapshot() {
  const cfg = readConfig();
  return {
    isDesktop: true,
    appVersion: updater.readInstalledVersion(),
    serverHost: cfg.serverHost,
    serverPort: cfg.serverPort,
    serverBase: serverConfig.serverBase(cfg),
    frontendBase: serverConfig.frontendBase(cfg),
  };
}

let serverSettingsWindow = null;

function openServerSettings() {
  if (serverSettingsWindow && !serverSettingsWindow.isDestroyed()) {
    serverSettingsWindow.focus();
    return;
  }
  serverSettingsWindow = new BrowserWindow({
    width: 540,
    height: 470,
    parent: mainWindow || undefined,
    modal: false,
    resizable: false,
    title: 'Balaji FeeHub - Server Settings',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  serverSettingsWindow.loadFile(path.join(__dirname, 'renderer', 'server-settings.html'));
  serverSettingsWindow.on('closed', () => { serverSettingsWindow = null; });
}

// -----------------------------------------------------------------------------
// Menu
// -----------------------------------------------------------------------------
function buildMenu() {
  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'Reload Balaji FeeHub', accelerator: 'F5', click: () => mainWindow && mainWindow.webContents.reload() },
        { label: 'Server Settings...', click: () => openServerSettings() },
        { type: 'separator' },
        { label: 'Exit', role: 'quit' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Toggle Full Screen', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Zoom In', role: 'zoomIn' },
        { label: 'Zoom Out', role: 'zoomOut' },
        { label: 'Reset Zoom', role: 'resetZoom' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'Check for Updates...',
          // The Main Server PC keeps the existing (unchanged) admin-gated
          // Server-update window. A real Client PC has no backend/frontend
          // to patch that way - it uses the simpler, no-PIN-required
          // signed .bcupdate flow against the Main Server's client-updates
          // endpoints instead (see updater/client-update.js).
          click: () => { if (isMainServer()) openUpdateWindow(); else runClientUpdateCheck({ silent: false }); },
        },
        {
          label: 'Create Diagnostic Report...',
          click: async () => {
            const res = await gatherDiagnostics(currentServerHost()).then(async (report) => {
              const stamp = new Date().toISOString().replace(/[:.]/g, '-');
              const file = path.join(app.getPath('desktop'), `BalajiFeeHub-Client-Diagnostic-${stamp}.txt`);
              fs.writeFileSync(file, report, 'utf8');
              return { ok: true, path: file };
            }).catch((err) => ({ ok: false, error: err.message }));
            if (res.ok) {
              const clicked = await dialog.showMessageBox(mainWindow, {
                type: 'info', title: 'Diagnostic report created',
                message: 'Diagnostic report saved to your Desktop.',
                detail: res.path,
                buttons: ['Open Folder', 'Close'], defaultId: 0, cancelId: 1,
              });
              if (clicked.response === 0) shell.showItemInFolder(res.path);
            } else {
              dialog.showErrorBox('Diagnostic report failed', res.error || 'Unknown error');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'About Balaji FeeHub',
          click: () => {
            const version = updater.readInstalledVersion();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Balaji FeeHub',
              message: 'Balaji FeeHub',
              detail:
                `Version ${version}\n` +
                'Balaji Convent & Junior College, Butibori, Nagpur\n\n' +
                'Fee & accounting software - LAN-based, offline-first.\n' +
                `Main Server: ${readConfig().serverHost}:${readConfig().serverPort}\n` +
                `Settings: ${CONFIG_FILE}`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// -----------------------------------------------------------------------------
// IPC from renderer
// -----------------------------------------------------------------------------
// Synchronous snapshot for preload.js - the bundled UI reads the server base
// before its first request (see frontend/src/lib/runtime.js).
ipcMain.on('runtime:get-config', (event) => {
  event.returnValue = runtimeSnapshot();
});

ipcMain.handle('server-config:get', async () => runtimeSnapshot());

// Test a candidate address WITHOUT saving it. A failed test never blocks saving:
// the Main Server may legitimately be switched off while settings are changed.
ipcMain.handle('server-config:test', async (_event, input) => {
  const n = serverConfig.normalizeServerAddress(input && input.host, input && input.port);
  if (!n.ok) return { ok: false, error: n.error };
  const reachable = await probeServer(n.host, n.port, MANUAL_TIMEOUT_MS);
  if (reachable) return { ok: true, host: n.host, port: n.port };
  return {
    ok: false,
    error: `No Balaji FeeHub Main Server answered at http://${n.host}:${n.port}. Check that the Main Server is running and that Windows Firewall allows port ${n.port}.`,
  };
});

// Save the address and reload the bundled UI so the new base takes effect at
// once. Local data (IndexedDB cache, pending queue) is kept across the reload.
ipcMain.handle('server-config:save', async (_event, input) => {
  const n = serverConfig.normalizeServerAddress(input && input.host, input && input.port);
  if (!n.ok) return n;
  writeConfig({ serverHost: n.host, serverPort: n.port, lastServerChangeAt: new Date().toISOString() });
  console.log(`[BalajiFeeHub] Main Server address set to ${n.host}:${n.port}`);
  if (serverSettingsWindow && !serverSettingsWindow.isDestroyed()) serverSettingsWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  return { ok: true, host: n.host, port: n.port };
});

// -----------------------------------------------------------------------------
// Printing — plain window.print() from the renderer opens Electron's built-in
// print dialog with system defaults (Portrait, default paper), ignoring the
// page's own @page CSS size/orientation. Receipts and other custom-size
// documents call window.feehub.print({widthMm, heightMm, landscape}) instead
// (see preload.js), which routes here so we can pass landscape + an explicit
// pageSize straight to Chromium's print pipeline - this is what preselects
// the correct orientation/size in the native dialog instead of leaving the
// operator to set it by hand every time.
// -----------------------------------------------------------------------------
function printWith(wc, printOptions) {
  return new Promise((resolve) => {
    try {
      wc.print(printOptions, (success, failureReason) => {
        resolve({ ok: success, error: success ? null : (failureReason || null) });
      });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

ipcMain.handle('print-page', async (event, opts = {}) => {
  const { widthMm, heightMm, landscape } = opts;
  const base = { silent: false, printBackground: true, landscape: !!landscape };

  // Many printer drivers (especially older PCL ones, e.g. the office's Canon
  // multifunction units) reject an arbitrary custom pageSize outright -
  // Chromium then cancels the whole print job before a dialog ever appears,
  // which used to silently fall all the way back to a plain, un-oriented
  // window.print(). Degrade in steps instead: try the exact size first, then
  // just the orientation (still far better than nothing), before giving up.
  if (widthMm && heightMm) {
    const exact = await printWith(event.sender, {
      ...base,
      // pageSize is the physical medium in its natural (unrotated)
      // orientation - narrower edge as width, longer edge as height, in
      // microns (1mm = 1000 microns). `landscape` above rotates onto it.
      pageSize: {
        width: Math.round(Math.min(widthMm, heightMm) * 1000),
        height: Math.round(Math.max(widthMm, heightMm) * 1000),
      },
    });
    if (exact.ok) return { ok: true, mode: 'exact-size' };
    console.warn(`[print] exact pageSize rejected (${exact.error}), retrying with orientation only`);
  }

  const orientOnly = await printWith(event.sender, base);
  if (orientOnly.ok) return { ok: true, mode: 'orientation-only' };
  return { ok: false, error: orientOnly.error, mode: 'failed' };
});

// -----------------------------------------------------------------------------
// Option E - dedicated receipt printing (NOT YET REGISTERED IN THE LIVE APP).
//
// This section is prepared per the Option E architecture but is only present
// in this scratch/checkpoint copy of main.js — it has not been repacked into
// the deployed app.asar. Do not activate until a candidate printer (HP
// LaserJet 4004dn/M404dn, Brother HL-L2351DW, or Canon LBP226dw) has passed
// the Windows AddForm test AND a physical 210x142.8mm print test.
//
// Deliberately different from print-page above in one critical way: NO
// window.print() fallback and NO orientation-only degradation. If the
// configured printer/size combination isn't already verified to work, this
// fails loudly instead of silently producing a wrong-size receipt — that
// silent-wrong-output failure mode is exactly what caused the original P1007
// A4 substitution bug, and the whole point of Option E is to never repeat it.
// -----------------------------------------------------------------------------
ipcMain.handle('print-receipt-direct', async (event, opts = {}) => {
  const { widthMm, heightMm, landscape, deviceName } = opts;
  if (!deviceName) {
    return { ok: false, error: 'No receipt printer is configured. Set one in Settings > Receipt before printing.' };
  }
  if (!widthMm || !heightMm) {
    return { ok: false, error: 'No receipt paper size is configured. Set it in Settings > Receipt before printing.' };
  }
  // pageSize unit/semantics — DELIBERATELY NOT the "natural/unrotated medium"
  // convention used by print-page's older exact-size attempt above (which
  // sorts into narrow=width/long=height via Math.min/Math.max). Electron's
  // documentation does not actually specify whether pageSize.width/height
  // are pre- or post-landscape-rotation, and no successful custom-pageSize
  // print has occurred yet on ANY driver this session to observe real
  // behavior empirically. Per explicit instruction, this path sends the
  // literal configured values instead: width=210000 (the 210mm figure),
  // height=142800 (the 142.8mm figure), landscape=true as a separate flag.
  // THIS MAPPING IS UNVERIFIED. Once a candidate printer passes the Windows
  // AddForm test, the very next step must be printing PrintGeometryDiagnostic
  // and physically measuring the output to confirm this convention is
  // actually correct for this Electron version/driver — if the physical
  // output comes out rotated or with width/height swapped, swap this mapping
  // and re-test. Do not assume either convention is right until measured.
  const printOptions = {
    silent: true,               // no OS printer-selection dialog - this is the whole point of Option E
    printBackground: true,
    landscape: !!landscape,
    deviceName,                 // explicit target - never the Windows default printer
    pageSize: {
      width: Math.round(widthMm * 1000),
      height: Math.round(heightMm * 1000),
    },
  };
  const result = await printWith(event.sender, printOptions);
  if (!result.ok) {
    return { ok: false, error: `The configured receipt printer (${deviceName}) is unavailable or the print job could not be sent. Please check the printer and try again.` };
  }
  return { ok: true };
});

// -----------------------------------------------------------------------------
// Option E - read-only printer paper-size enumeration for the admin Settings
// "Test Printer Compatibility" check. Deliberately does NOT attempt
// AddForm/EnumForms here - registering a genuinely new Windows Form requires
// an elevated (admin) process token, which this app does not and should not
// run with on a cashier PC (confirmed firsthand: even this developer's own
// interactive session needed a separate elevated PowerShell window for
// AddForm to succeed - whoami showed "BUILTIN\Administrators ... Group used
// for deny only" on the unelevated token). So the one-time "does Windows
// actually accept this exact custom form" verification stays a manual,
// elevated, one-off IT/admin action (see printer-compat-check.ps1), and its
// result is recorded into Settings by the admin afterward
// (receipt_printer_verified / receipt_printer_verified_at). This handler only
// answers the safe, unprivileged question: what paper sizes does the
// currently configured printer's own driver already expose right now.
// -----------------------------------------------------------------------------
ipcMain.handle('check-printer-paper-sizes', async (_event, printerName) => {
  if (!printerName) return { ok: false, error: 'No printer name given.' };
  const psScript = `
Add-Type -AssemblyName System.Drawing
$ps = New-Object System.Drawing.Printing.PrinterSettings
$ps.PrinterName = ${JSON.stringify(printerName)}
if (-not $ps.IsValid) { Write-Output "INVALID_PRINTER"; exit 1 }
Write-Output "VALID"
$ps.PaperSizes | ForEach-Object { Write-Output "$($_.PaperName)|$($_.Width)|$($_.Height)" }
`.trim();
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { timeout: 10000 }, (err, stdout) => {
      if (err) { resolve({ ok: false, error: err.message }); return; }
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines[0] !== 'VALID') { resolve({ ok: false, error: 'Printer not found or not valid on this PC.' }); return; }
      const sizes = lines.slice(1).map((l) => {
        const [name, w, h] = l.split('|');
        return { name, widthMm: Math.round((Number(w) / 100) * 25.4 * 10) / 10, heightMm: Math.round((Number(h) / 100) * 25.4 * 10) / 10 };
      });
      resolve({ ok: true, sizes });
    });
  });
});

// -----------------------------------------------------------------------------
// TEMPORARY, dev-only - Option E physical printing investigation on the HP
// LaserJet P1007. Remove once physical printing is verified and the real
// Settings-driven print-receipt-direct path (above) takes over.
//
// Deliberately uses the NAMED 'A5' pageSize string, not a custom
// {width,height} object - this is the well-supported, standard Windows/
// Chromium code path (dmPaperSize=DMPAPER_A5 + dmOrientation=LANDSCAPE as
// separate, well-defined DEVMODE fields), unlike custom pageSize objects
// which earlier testing showed are unreliable on this Electron version on
// Windows. This is the ONLY place orientation is set for this test - no CSS
// transform, no canvas rotation, no second rotation anywhere else.
// -----------------------------------------------------------------------------
ipcMain.handle('print-test-receipt-a5', async (event, opts = {}) => {
  const { deviceName } = opts;
  if (!deviceName) {
    return { ok: false, error: 'No printer specified for the test print.' };
  }
  const result = await printWith(event.sender, {
    silent: true,
    printBackground: true,
    landscape: true,
    deviceName,
    pageSize: 'A5',
  });
  if (!result.ok) {
    return { ok: false, error: `Test print to ${deviceName} failed: ${result.error || 'unknown error'}` };
  }
  return { ok: true };
});

ipcMain.handle('diagnostics:create', async (_event, targetIp) => {
  try {
    const report = await gatherDiagnostics(targetIp);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(app.getPath('desktop'), `BalajiFeeHub-Client-Diagnostic-${stamp}.txt`);
    fs.writeFileSync(file, report, 'utf8');
    return { ok: true, path: file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('diagnostics:openLocation', async (_event, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  else shell.openPath(app.getPath('desktop'));
  return { ok: true };
});

// -----------------------------------------------------------------------------
// Updater
// -----------------------------------------------------------------------------
let clientUpdateWindow = null;

function openClientUpdateProgressWindow(info) {
  if (clientUpdateWindow && !clientUpdateWindow.isDestroyed()) {
    clientUpdateWindow.focus();
    return clientUpdateWindow;
  }
  clientUpdateWindow = new BrowserWindow({
    width: 560,
    height: 500,
    parent: mainWindow || undefined,
    modal: false,
    title: 'Balaji FeeHub - Updating',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  clientUpdateWindow.loadURL('file://' + path.join(__dirname, 'renderer', 'client-update.html'));
  clientUpdateWindow.on('closed', () => { clientUpdateWindow = null; });
  return clientUpdateWindow;
}

function sendClientUpdateProgress(data) {
  if (clientUpdateWindow && !clientUpdateWindow.isDestroyed()) {
    clientUpdateWindow.webContents.send('client-update:progress', data);
  }
}

let updateWindow = null;

function openUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.focus();
    return;
  }
  updateWindow = new BrowserWindow({
    width: 720,
    height: 640,
    parent: mainWindow || undefined,
    modal: false,
    title: 'Balaji FeeHub - Check for Updates',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  updateWindow.loadURL('file://' + path.join(__dirname, 'renderer', 'update.html'));
  updateWindow.on('closed', () => { updateWindow = null; });
}

ipcMain.handle('updater:reconnect', async () => {
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close();
  if (mainWindow) {
    // An update may have just changed the frontend build on disk - always
    // clear the cache and hard-reload rather than a plain reload(), which
    // would still honor any previously cached response for this origin.
    await clearCacheIfVersionChanged();
    if (typeof mainWindow.webContents.reloadIgnoringCache === 'function') {
      mainWindow.webContents.reloadIgnoringCache();
    } else {
      mainWindow.webContents.reload();
    }
  }
  return { ok: true };
});

updater.registerIpc({
  getServerIp: () => { const c = readConfig(); return `${c.serverHost}:${c.serverPort}`; },
  showUpdateWindow: openUpdateWindow,
});

// Silent background check ~30 seconds after startup. Never interrupts the user.
function scheduleBackgroundCheck() {
  setTimeout(async () => {
    try {
      const info = await updater.checkForUpdates();
      if (info && info.available && mainWindow && !mainWindow.isDestroyed()) {
        const clicked = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Balaji FeeHub update available',
          message: `Balaji FeeHub ${info.remote} is available.`,
          detail: `You are on ${info.installed}.\nDownload size: ${info.downloadSizeBytes ? (info.downloadSizeBytes / 1024 / 1024).toFixed(1) + ' MB' : 'unknown'}\n\n${(info.notes || '').slice(0, 400)}`,
          buttons: ['View Update', 'Later'],
          defaultId: 0,
          cancelId: 1,
        });
        if (clicked.response === 0) openUpdateWindow();
      }
    } catch (_) { /* offline / GitHub down — stay silent */ }
  }, 30_000);
}

// -----------------------------------------------------------------------------
// Client (Electron shell) update - signed .bcupdate distributed by the
// EXISTING Main Server (never GitHub). See updater/client-update.js. This is
// completely separate from the Server-update flow above: no admin login, no
// PIN, no separate window - the trust comes entirely from the RSA signature
// check, and the only human action needed is "Update Now" / "Later".
// -----------------------------------------------------------------------------
function isMainServer() { return serverConfig.isLocalMainServer(readConfig()); }

async function runClientUpdateCheck({ silent }) {
  // Best-effort: flush any update-outcome report that couldn't reach the
  // Main Server earlier (queued locally) - piggybacks on the same periodic
  // tick that already runs every 30 min plus on manual "Check for Updates".
  const serverAuthority = currentServerAuthority();
  clientUpdate.flushQueuedReports(serverAuthority).catch(() => {});
  const info = await clientUpdate.checkForClientUpdate(serverAuthority);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (info.offline || info.error) {
    // "Main Server OFF" must never surface as an error popup - this is the
    // expected common case on a school LAN. A manual check still gets a
    // small, calm acknowledgement rather than silence.
    if (!silent) {
      dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'Check for Updates',
        message: 'Could not reach the Main Server to check for updates.',
        detail: 'The Main Server may be temporarily unavailable. Balaji FeeHub continues to work normally - try again once it is back.',
        buttons: ['OK'],
      });
    }
    return;
  }
  if (!info.available) {
    if (!silent) {
      dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'Check for Updates',
        message: `Balaji FeeHub is up to date (v${info.installed}).`,
        buttons: ['OK'],
      });
    }
    return;
  }
  const clicked = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'New FeeHub Client Update Available',
    message: 'New FeeHub Client Update Available',
    detail: `Current Version: v${info.installed}\nNew Version: v${info.remote}\n\n${(info.releaseNotes || '').slice(0, 400)}`,
    buttons: ['Update Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (clicked.response !== 0) return; // Later - continue using the current Client, check again next time.
  await performClientUpdate(info);
}

async function performClientUpdate(info) {
  openClientUpdateProgressWindow(info);
  // Every stage sent below corresponds to a real completed step, not a
  // timed/faked animation: download % is real byte progress from the actual
  // HTTP transfer; 'verifying'/'signature' are sent only once those genuine
  // checks have actually passed (they're fast, in-memory operations with no
  // natural sub-progress of their own, unlike the download).
  sendClientUpdateProgress({ stage: 'downloading', installed: info.installed, remote: info.remote, received: 0, total: info.packageSize || 0 });
  try {
    const dl = await clientUpdate.downloadClientUpdate(info.downloadUrl, info.expectedSha256, (received, total) => {
      sendClientUpdateProgress({ stage: 'downloading', received, total });
    });
    sendClientUpdateProgress({ stage: 'verifying' });
    const { appAsarBuf, expectedSha } = clientUpdate.verifyAndExtractPackage(dl.path, clientUpdate.readInstalledVersion());
    sendClientUpdateProgress({ stage: 'signature' });
    sendClientUpdateProgress({ stage: 'finalizing' });
    await clientUpdate.applyClientUpdateAndRestart(appAsarBuf, expectedSha, info.remote);
  } catch (e) {
    sendClientUpdateProgress({ stage: 'failed', message: e.message || String(e) });
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Update failed', `The update could not be applied safely, so nothing was changed.\n\n${e.message || e}`);
    }
  }
}

// Periodic check (never on the Main Server PC itself - it has no client
// update to apply to). Non-blocking: scheduled well after the window is
// already shown, and every failure path above is silent unless the user
// explicitly asked via the menu.
function scheduleClientUpdateCheck() {
  const tick = () => {
    if (isMainServer()) return;
    runClientUpdateCheck({ silent: true }).catch(() => {});
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 30 * 60 * 1000);
}

// Reports the outcome of an update applied on the PREVIOUS run (see
// client-update.js's HELPER_SOURCE, which writes this marker right before
// relaunching). Shown once, shortly after the window is visible, then the
// marker is cleared so it never repeats.
function reportPendingClientUpdateResult() {
  const result = clientUpdate.consumePendingUpdateResult();
  if (!result || !mainWindow) return;
  const stage = result.stage || (result.ok ? 'installed' : 'unknown');
  // 'pending'/'started' with nothing further means the helper never got far
  // enough to touch app.asar at all - the OLD version is fully intact, so
  // this must never be worded as a rollback (nothing needed rolling back).
  const neverStartedInstall = stage === 'pending' || stage === 'started' || stage === 'backup_starting' || stage === 'failed_backup' || stage === 'failed_helper_spawn';
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (result.ok) {
      dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'Update Complete',
        message: `Balaji FeeHub was updated to v${result.toVersion}.`,
        buttons: ['OK'],
      });
    } else if (neverStartedInstall) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning', title: 'Update Did Not Start',
        message: 'The update could not be started, so nothing was changed. Balaji FeeHub is still running its previous version.',
        detail: result.error || '',
        buttons: ['OK'],
      });
    } else {
      dialog.showMessageBox(mainWindow, {
        type: 'warning', title: 'Update Failed - Restored Previous Version',
        message: result.rolledBack
          ? 'The update could not be applied and was automatically rolled back. Balaji FeeHub is running the previous version.'
          : 'The update did not complete. Balaji FeeHub is running the previous version.',
        detail: result.error || '',
        buttons: ['OK'],
      });
    }
  }, 2000);
  clientUpdate.reportUpdateOutcome({ ...result, stage, currentServerIp: currentServerAuthority(), installedVersion: clientUpdate.readInstalledVersion() }).catch(() => {});
}

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createMainWindow();
    scheduleBackgroundCheck();
    scheduleClientUpdateCheck();
    reportPendingClientUpdateResult();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}
