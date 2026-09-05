const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('feehub', {
  onProgress: (cb) => ipcRenderer.on('connect-progress', (_e, msg) => cb(msg)),
  onDiscoveryFailed: (cb) => ipcRenderer.on('discovery-failed', () => cb()),
  connectManual: (ip) => ipcRenderer.invoke('connect-manual', ip),
  rediscover: () => ipcRenderer.invoke('rediscover'),
  getSavedServer: () => ipcRenderer.invoke('get-saved-server'),

  // opts: { widthMm, heightMm, landscape } - omit widthMm/heightMm to just
  // force orientation on the system default paper size.
  print: (opts) => ipcRenderer.invoke('print-page', opts),

  // Option E — dedicated receipt printing (NOT YET REGISTERED on the main
  // process side of the currently deployed app.asar; see main.js). Silent,
  // deviceName-targeted, exact size, no fallback.
  // opts: { widthMm, heightMm, landscape, deviceName }
  printReceiptDirect: (opts) => ipcRenderer.invoke('print-receipt-direct', opts),

  // Option E — read-only: what paper sizes does this printer's own driver
  // currently expose (Settings > Receipt > Test Printer Compatibility).
  checkPrinterPaperSizes: (printerName) => ipcRenderer.invoke('check-printer-paper-sizes', printerName),

  // TEMPORARY, dev-only — Option E physical printing investigation on the
  // HP LaserJet P1007. opts: { deviceName }. Remove once verified.
  printTestReceiptA5: (opts) => ipcRenderer.invoke('print-test-receipt-a5', opts),

  diagnostics: {
    create: (targetIp) => ipcRenderer.invoke('diagnostics:create', targetIp),
    openLocation: (filePath) => ipcRenderer.invoke('diagnostics:openLocation', filePath),
  },

  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    getContext: () => ipcRenderer.invoke('updater:context'),
    downloadAndInstall: (opts) => ipcRenderer.invoke('updater:downloadAndInstall', opts),
    downloadAndRunFullInstaller: (opts) => ipcRenderer.invoke('updater:downloadAndRunFullInstaller', opts),
    onProgress: (cb) => ipcRenderer.on('updater:progress', (_e, data) => cb(data)),
    removeAllProgressListeners: () => ipcRenderer.removeAllListeners('updater:progress'),
    openExternal: (url) => ipcRenderer.invoke('updater:openReleaseNotes', url),
    reconnect: () => ipcRenderer.invoke('updater:reconnect'),
  },
});
