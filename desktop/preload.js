const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  printTicket: () => ipcRenderer.invoke('print-ticket'),
  getPrinterStatus: () => ipcRenderer.invoke('get-printer-status'),
  savePrinter: (printerName) => ipcRenderer.invoke('save-printer', printerName),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  saveAutostart: (enabled) => ipcRenderer.invoke('save-autostart', enabled),
  openPrinterSettings: () => ipcRenderer.invoke('open-printer-settings'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info')
});
