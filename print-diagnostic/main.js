// FeeHub Print Diagnostic — Electron main process.
// Standalone. No FeeHub server/DB. Records everything about each print job and
// physically prints via the real Electron desktop pipeline (never window.print).
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_VERSION = require('./package.json').version;
let win = null;

// Application paper source -> physical media page (landscape). Printer-generic.
const SOURCES = {
  SPECIAL: { pageSizeName: 'A5', wmm: 210, hmm: 148, phys: 'A5 210 x 148 mm' },
  A5:      { pageSizeName: 'A5', wmm: 210, hmm: 148, phys: 'A5 210 x 148 mm' },
  A4:      { pageSizeName: 'A4', wmm: 297, hmm: 210, phys: 'A4 297 x 210 mm' },
};

function diagRoot() {
  const base = app.getPath('documents') || app.getPath('userData');
  const dir = path.join(base, 'FeeHubPrintDiagnostic');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 760, title: 'FeeHub Print Diagnostic',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ---- IPC: list printers -------------------------------------------------
ipcMain.handle('list-printers', async () => {
  try {
    const wc = win.webContents;
    const printers = (await wc.getPrintersAsync?.()) || wc.getPrinters?.() || [];
    return printers.map(p => ({ name: p.name, isDefault: !!p.isDefault, status: p.status, description: p.description }));
  } catch (e) { return []; }
});

// ---- IPC: environment ---------------------------------------------------
function environment() {
  return {
    windowsRelease: os.release(), platform: process.platform, arch: process.arch,
    appVersion: APP_VERSION, electron: process.versions.electron,
    chromium: process.versions.chrome, node: process.versions.node, v8: process.versions.v8,
  };
}

// ---- IPC: print test (records EVERYTHING, sends exactly ONE job) ---------
ipcMain.handle('print-test', async (event, opts = {}) => {
  const deviceName = opts.deviceName;
  const source = (opts.source || 'SPECIAL').toUpperCase();
  const m = SOURCES[source] || SOURCES.SPECIAL;
  const ts = stamp();
  const folder = path.join(diagRoot(), `PrintTest_${ts}`);
  fs.mkdirSync(folder, { recursive: true });

  // ---- Print mode: how we ask Windows/the driver for orientation & media ----
  // HP host-based GDI drivers (M1005 / P1007) honour these very differently,
  // so the tool can try several and record which one prints correctly.
  const LW = m.wmm, LH = m.hmm; // landscape media dims (A5: 210x148, A4: 297x210)
  // Single rotation control the cashier changes until the receipt prints upright & complete.
  // 90/270 use the printer's NATIVE portrait A5/A4 form (no custom size, no scaling) with the
  // artwork pre-rotated -> most reliable on HP host-based GDI drivers. Load paper VERTICALLY.
  // 0/180 use an explicit landscape page size -> load paper HORIZONTALLY.
  const mode = (opts.mode || 'rot-90');
  const nx = Number.isFinite(+opts.nudgeX) ? +opts.nudgeX : 0;  // page-space nudge mm, +right / -left
  const ny = Number.isFinite(+opts.nudgeY) ? +opts.nudgeY : 0;  // page-space nudge mm, +down / -up
  let pagew, pageh, rot, landscape, pageSize;
  if (mode === 'rot-90' || mode === 'rot-270') {
    pagew = LH; pageh = LW; rot = (mode === 'rot-90') ? 90 : 270; landscape = false;
    pageSize = m.pageSizeName;                        // native A5/A4 portrait form (no scaling)
  } else {
    pagew = LW; pageh = LH; rot = (mode === 'rot-180') ? 180 : 0; landscape = false;
    pageSize = { width: Math.round(LW * 1000), height: Math.round(LH * 1000) };
  }

  const diag = {
    testId: ts,
    timestampIso: new Date().toISOString(),
    expected: { artworkMm: { w: 210, h: 142.8 }, physicalMediaMm: { w: m.wmm, h: m.hmm }, orientation: 'landscape', source, mode },
    request: null, environment: environment(), printer: null, renderer: null,
    electron: {}, windows: {}, result: { status: 'PENDING', error: null },
  };

  // Hidden window that loads the SAME receipt renderer used for preview.
  const printWin = new BrowserWindow({
    show: false, width: Math.round(pagew * 3.7795), height: Math.round(pageh * 3.7795),
    webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: false },
  });
  const url = 'file://' + path.join(__dirname, 'renderer', 'receipt.html') +
    `?source=${encodeURIComponent(source)}&printer=${encodeURIComponent(deviceName || '-')}&ts=${encodeURIComponent(diag.timestampIso)}` +
    `&markers=${opts.markers ? 'on' : 'off'}&pagew=${pagew}&pageh=${pageh}&rot=${rot}&nx=${nx}&ny=${ny}`;

  try {
    await printWin.loadURL(url);
    await new Promise(r => setTimeout(r, 350));

    // Printer info reported by Windows/Chromium.
    try {
      const printers = (await printWin.webContents.getPrintersAsync?.()) || [];
      const found = printers.find(p => p.name === deviceName) || null;
      diag.printer = found ? {
        name: found.name, isDefault: !!found.isDefault, status: found.status,
        description: found.description, options: found.options || null,
      } : { name: deviceName, note: 'Selected printer not found in Chromium printer list.' };
      diag.windows.allPrinters = printers.map(p => p.name);
    } catch (e) { diag.printer = { name: deviceName, error: String(e) }; }

    // Renderer measurements from the authoritative receipt DOM.
    try { diag.renderer = await printWin.webContents.executeJavaScript('window.__diagMeasure ? window.__diagMeasure() : null'); }
    catch (e) { diag.renderer = { error: String(e) }; }

    // Screenshot of exactly the rendered receipt (no desktop capture).
    try {
      const img = await printWin.webContents.capturePage();
      fs.writeFileSync(path.join(folder, 'receipt.png'), img.toPNG());
    } catch (e) { diag.electron.captureError = String(e); }

    // Print parameters — the exact desktop pipeline (never window.print()).
    const printOptions = {
      silent: true, printBackground: true, landscape: landscape, deviceName,
      margins: { marginType: 'none' }, pageSize: pageSize, copies: 1,
    };
    diag.request = {
      selectedPrinter: deviceName, applicationPaperSource: source, printMode: mode,
      artworkWidthMm: 210, artworkHeightMm: 142.8, physicalMediaWidthMm: m.wmm, physicalMediaHeightMm: m.hmm,
      pageWidthMm: pagew, pageHeightMm: pageh, contentRotationDeg: rot, nudgeXmm: nx, nudgeYmm: ny, orientationFlag: landscape,
      margins: 'none', scale: '100% (no fit-to-page)',
      pageSize: pageSize, silent: true, deviceName, ipcParams: printOptions,
    };
    diag.electron.printOptions = printOptions;

    const printResult = await new Promise((resolve) => {
      try {
        printWin.webContents.print(printOptions, (success, failureReason) => resolve({ success, failureReason }));
      } catch (e) { resolve({ success: false, failureReason: 'exception: ' + String(e) }); }
    });
    diag.electron.printResult = printResult;

    if (printResult.success) { diag.result.status = 'SUCCESS'; }
    else { diag.result.status = 'FAILURE'; diag.result.error = printResult.failureReason || 'Print job not accepted.'; }
  } catch (e) {
    diag.result.status = 'FAILURE'; diag.result.error = 'exception: ' + String(e);
  } finally {
    try { printWin.destroy(); } catch {}
  }

  writeDiag(folder, diag);
  return {
    ok: diag.result.status === 'SUCCESS', folder,
    error: diag.result.error,
    measuredMm: diag.renderer && diag.renderer.artworkBoundingMm
      ? `${diag.renderer.artworkBoundingMm.w} x ${diag.renderer.artworkBoundingMm.h} mm (page ${diag.renderer.pageMm ? diag.renderer.pageMm.w + '×' + diag.renderer.pageMm.h : '?'}, rot ${diag.renderer.rot})` : 'n/a',
  };
});

function writeDiag(folder, diag) {
  fs.writeFileSync(path.join(folder, 'diagnostic.json'), JSON.stringify(diag, null, 2));
  const L = [];
  L.push('FEEHUB PRINT DIAGNOSTIC — ' + diag.testId);
  L.push('Time: ' + diag.timestampIso);
  L.push('Result: ' + diag.result.status + (diag.result.error ? (' — ' + diag.result.error) : ''));
  L.push('');
  L.push('== EXPECTED =='); L.push(JSON.stringify(diag.expected));
  L.push('== REQUESTED BY SOFTWARE =='); L.push(JSON.stringify(diag.request));
  L.push('== RENDERER (DOM) =='); L.push(JSON.stringify(diag.renderer));
  L.push('== WINDOWS / PRINTER =='); L.push(JSON.stringify(diag.printer)); L.push(JSON.stringify(diag.windows));
  L.push('== ELECTRON =='); L.push(JSON.stringify(diag.electron));
  L.push('== ENVIRONMENT =='); L.push(JSON.stringify(diag.environment));
  if (diag.observation) { L.push('== USER PHYSICAL OBSERVATION =='); L.push(JSON.stringify(diag.observation)); }
  fs.writeFileSync(path.join(folder, 'diagnostic.txt'), L.join('\n'));
}

// ---- IPC: save physical observation (appended to the report) ------------
ipcMain.handle('save-observation', async (event, payload = {}) => {
  try {
    const folder = payload.folder;
    const jsonPath = path.join(folder, 'diagnostic.json');
    const diag = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    diag.observation = payload.observation;
    writeDiag(folder, diag);
    fs.writeFileSync(path.join(folder, 'observation.txt'), JSON.stringify(payload.observation, null, 2));
    return { ok: true, folder };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// ---- IPC: open the diagnostic folder ------------------------------------
ipcMain.handle('open-log', async (event, folder) => {
  try { const target = folder || diagRoot(); await shell.openPath(target); return target; }
  catch (e) { return null; }
});
