/**
 * Balaji FeeHub - Electron main process
 *
 * One EXE, two behaviours:
 *   - On the Main Server PC: auto-detects http://127.0.0.1:8001 -> loads http://127.0.0.1:3000
 *   - On a Client PC:        loads saved server IP from %APPDATA%\BalajiFeeHub\config.json,
 *                            else LAN /24 scan, else manual entry via connect.html
 *
 * MongoDB stays on 127.0.0.1 on the Main Server. Clients only ever talk to the
 * backend + frontend on ports 8001/3000 - never to Mongo directly.
 */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const { execFile } = require('child_process');
const updater = require('./updater/updater');

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
// Config persistence
// -----------------------------------------------------------------------------
const CONFIG_DIR = path.join(app.getPath('appData'), 'BalajiFeeHub');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const BACKEND_PORT = 8001;
const FRONTEND_PORT = 3000;
const PROBE_TIMEOUT_MS = 800;
const MANUAL_TIMEOUT_MS = 5000;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}
function writeConfig(cfg) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write config:', err);
  }
}

// -----------------------------------------------------------------------------
// Server probing
// -----------------------------------------------------------------------------
function probeServer(ip, timeoutMs) {
  return new Promise((resolve) => {
    const options = { host: ip, port: BACKEND_PORT, path: '/api/version', timeout: timeoutMs };
    const req = http.get(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; if (body.length > 4096) { req.destroy(); } });
      res.on('end', () => {
        if (res.statusCode === 200) resolve(true); else resolve(false);
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

async function scanLan(onProgress) {
  const subnets = getLocalSubnets();
  for (const prefix of subnets) {
    const promises = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${prefix}${i}`;
      promises.push(
        probeServer(ip, PROBE_TIMEOUT_MS).then((ok) => (ok ? ip : null))
      );
    }
    if (onProgress) onProgress(`Scanning ${prefix}0/24 (254 addresses in parallel)...`);
    const results = await Promise.all(promises);
    const found = results.find((x) => x);
    if (found) return found;
  }
  return null;
}

async function detectMainServer(onProgress) {
  if (onProgress) onProgress('Checking local Main Server (127.0.0.1)...');
  if (await probeServer('127.0.0.1', 1500)) return '127.0.0.1';

  const cfg = readConfig();
  if (cfg.serverIp && cfg.serverIp !== '127.0.0.1') {
    if (onProgress) onProgress(`Trying saved Main Server (${cfg.serverIp})...`);
    if (await probeServer(cfg.serverIp, 3000)) return cfg.serverIp;
  }

  if (onProgress) onProgress('Scanning your school LAN for the Main Server...');
  const found = await scanLan(onProgress);
  return found;
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
  const host = targetIp || currentServerIp || readConfig().serverIp || null;
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

    const port3000 = await tcpPortTest(host, FRONTEND_PORT, 2000);
    push(`Port 3000 (frontend): ${port3000.ok ? 'OK - reachable' : 'FAILED - ' + port3000.detail}`);

    const port8001 = await tcpPortTest(host, BACKEND_PORT, 2000);
    push(`Port 8001 (backend) : ${port8001.ok ? 'OK - reachable' : 'FAILED - ' + port8001.detail}`);

    const apiVer = await httpVersionTest(host, BACKEND_PORT, 3000);
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
let currentServerIp = null;

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

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // External links (mailto, https support portal, etc.) open in system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(`http://${currentServerIp}:`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // If the loaded backend disappears (Main Server goes down), fall back to connect.
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL) => {
    if (validatedURL && validatedURL.includes(`:${FRONTEND_PORT}`)) {
      console.warn(`Lost connection to ${validatedURL} (${errorCode} ${errorDesc}) - showing connect screen`);
      showConnectScreen(`Lost connection to Main Server at ${currentServerIp}.`);
    }
  });

  buildMenu();
  showConnectScreen();
  startDetectionFlow();
}

function showConnectScreen(errorMessage) {
  if (!mainWindow) return;
  const url = 'file://' + path.join(__dirname, 'renderer', 'connect.html');
  const suffix = errorMessage ? `?error=${encodeURIComponent(errorMessage)}` : '';
  mainWindow.loadURL(url + suffix);
}

function loadServerApp(ip) {
  if (!mainWindow) return;
  currentServerIp = ip;
  writeConfig({ serverIp: ip, lastConnectedAt: new Date().toISOString() });
  mainWindow.loadURL(`http://${ip}:${FRONTEND_PORT}`);
}

async function startDetectionFlow() {
  const send = (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connect-progress', msg);
    }
  };
  send('Starting...');
  try {
    const ip = await detectMainServer(send);
    if (ip) {
      send(`Found Main Server at ${ip}. Loading Balaji FeeHub...`);
      await clearCacheIfVersionChanged();
      setTimeout(() => loadServerApp(ip), 300);
    } else {
      send(null);
      if (mainWindow) mainWindow.webContents.send('discovery-failed');
    }
  } catch (err) {
    console.error('Detection error:', err);
    if (mainWindow) mainWindow.webContents.send('discovery-failed');
  }
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
        { label: 'Change Main Server...', click: () => { currentServerIp = null; showConnectScreen(); startDetectionFlow(); } },
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
          click: () => openUpdateWindow(),
        },
        {
          label: 'Create Diagnostic Report...',
          click: async () => {
            const res = await gatherDiagnostics(currentServerIp).then(async (report) => {
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
                (currentServerIp ? `Connected to Main Server: ${currentServerIp}\n` : '') +
                `Config: ${CONFIG_FILE}`,
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
ipcMain.handle('connect-manual', async (_event, rawIp) => {
  const ip = (rawIp || '').trim().replace(/^https?:\/\//i, '').replace(/:\d+.*$/, '').replace(/\/$/, '');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return { ok: false, error: 'Please enter a valid IPv4 address (e.g. 192.168.1.10).' };
  }
  const ok = await probeServer(ip, MANUAL_TIMEOUT_MS);
  if (!ok) {
    return {
      ok: false,
      error: `Could not reach the Balaji FeeHub Main Server at http://${ip}:${BACKEND_PORT}. Check that the Main Server is running and that Windows Firewall allows port ${BACKEND_PORT}.`,
    };
  }
  loadServerApp(ip);
  return { ok: true, ip };
});

ipcMain.handle('rediscover', async () => {
  showConnectScreen();
  startDetectionFlow();
  return { ok: true };
});

ipcMain.handle('get-saved-server', async () => {
  return readConfig();
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
  if (mainWindow && currentServerIp) {
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
  getServerIp: () => currentServerIp || '127.0.0.1',
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
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}
