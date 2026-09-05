// Secure bridge — exposes only the diagnostic IPC to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('diag', {
  listPrinters: () => ipcRenderer.invoke('list-printers'),
  printTest: (opts) => ipcRenderer.invoke('print-test', opts),
  saveObservation: (payload) => ipcRenderer.invoke('save-observation', payload),
  openLog: (folder) => ipcRenderer.invoke('open-log', folder),
});
