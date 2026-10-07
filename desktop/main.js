const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { autoUpdater } = require('electron-updater');

const APP_NAME = 'LAVAARTE OS';
const MAIN_FILE = path.join(__dirname, 'app', 'index.html');
const PRINTER_FILE = path.join(__dirname, 'printer-settings.html');
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

let mainWindow = null;
let printerWindow = null;
let printQueue = Promise.resolve();

function defaultConfig() {
  return { selectedPrinter: '', autostart: true, version: 1 };
}

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return defaultConfig();
    return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch (_) {
    return defaultConfig();
  }
}

function writeConfig(patch) {
  const current = readConfig();
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function configureAutostart(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
      args: ['--hidden-start']
    });
  } catch (_) {}
}

function getSavedPrinter() {
  return readConfig().selectedPrinter || '';
}

async function getPrinters() {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(p => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: Boolean(p.isDefault),
      status: p.status,
      description: p.description || ''
    }));
  } catch (error) {
    console.error('[LAVAARTE] Error obteniendo impresoras:', error);
    return [];
  }
}

function buildPrinterStatus() {
  return getPrinters().then(printers => ({
    printers,
    selected: getSavedPrinter(),
    autostart: readConfig().autostart !== false
  }));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b1120',
    title: APP_NAME,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(MAIN_FILE);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openPrinterSettings() {
  if (printerWindow && !printerWindow.isDestroyed()) {
    printerWindow.focus();
    return;
  }

  printerWindow = new BrowserWindow({
    width: 620,
    height: 610,
    resizable: false,
    parent: mainWindow || undefined,
    modal: false,
    title: 'LAVAARTE OS - Configuración',
    backgroundColor: '#0b1120',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  printerWindow.loadFile(PRINTER_FILE);
  printerWindow.on('closed', () => { printerWindow = null; });
}

function createMenu() {
  const template = [
    {
      label: 'LAVAARTE',
      submenu: [
        { label: 'Configuración de impresora', click: openPrinterSettings },
        { label: 'Buscar actualizaciones', click: () => checkForUpdates(true) },
        { type: 'separator' },
        { label: 'Recargar sistema', accelerator: 'Ctrl+R', click: () => mainWindow?.reload() },
        { type: 'separator' },
        { role: 'quit', label: 'Salir de LAVAARTE OS' }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Acerca de LAVAARTE OS',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'LAVAARTE OS',
              message: 'LAVAARTE OS',
              detail: `Sistema de gestión de lavandería\nVersión ${app.getVersion()}\nLAVAARTE S.A.S.`
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function performPrint() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.reject(new Error('La ventana principal no está disponible.'));
  }

  return new Promise((resolve, reject) => {
    const config = readConfig();
    const deviceName = config.selectedPrinter || undefined;
    const options = {
      silent: true,
      printBackground: true,
      usePrinterDefaultPageSize: true,
      ...(deviceName ? { deviceName } : {})
    };

    mainWindow.webContents.print(options, (success, failureReason) => {
      if (success) resolve({ ok: true, printer: deviceName || 'predeterminada' });
      else reject(new Error(failureReason || 'La impresora rechazó el trabajo.'));
    });
  });
}

ipcMain.handle('print-ticket', async () => {
  printQueue = printQueue.then(() => performPrint());
  try {
    return await printQueue;
  } catch (error) {
    console.error('[LAVAARTE] Error de impresión:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('get-printer-status', async () => buildPrinterStatus());

ipcMain.handle('save-printer', async (_event, printerName) => {
  const printers = await getPrinters();
  const valid = !printerName || printers.some(p => p.name === printerName);
  if (!valid) return { ok: false, error: 'La impresora seleccionada ya no está disponible.' };
  writeConfig({ selectedPrinter: String(printerName || '') });
  return { ok: true, selected: String(printerName || '') };
});

ipcMain.handle('get-autostart', () => readConfig().autostart !== false);
ipcMain.handle('save-autostart', (_event, enabled) => {
  const value = Boolean(enabled);
  writeConfig({ autostart: value });
  configureAutostart(value);
  return { ok: true, autostart: value };
});
ipcMain.handle('open-printer-settings', () => {
  openPrinterSettings();
  return { ok: true };
});
ipcMain.handle('get-app-info', () => ({ name: APP_NAME, version: app.getVersion(), platform: process.platform, arch: process.arch }));

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => console.log('[LAVAARTE] Buscando actualización...'));
  autoUpdater.on('update-available', info => {
    console.log(`[LAVAARTE] Actualización disponible: ${info.version}`);
  });
  autoUpdater.on('update-not-available', info => {
    console.log(`[LAVAARTE] Ya está actualizado: ${info.version}`);
  });
  autoUpdater.on('download-progress', p => {
    console.log(`[LAVAARTE] Descarga ${Math.round(p.percent)}%`);
  });
  autoUpdater.on('update-downloaded', info => {
    console.log(`[LAVAARTE] Actualización descargada: ${info.version}`);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'LAVAARTE OS',
      message: `La versión ${info.version} ya está lista.`,
      detail: 'LAVAARTE OS se actualizará al cerrar y volver a abrir el programa.',
      buttons: ['Actualizar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1
    }).then(result => {
      if (result.response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });
  autoUpdater.on('error', error => console.error('[LAVAARTE] Error del actualizador:', error));
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) dialog.showMessageBox({ type: 'info', title: 'Actualizaciones', message: 'El actualizador se activa en la versión instalada, no durante desarrollo.' });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error('[LAVAARTE] No se pudo comprobar actualización:', error);
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Actualizaciones',
        message: 'No se pudo comprobar la actualización.',
        detail: error.message
      });
    }
  }
}

app.whenReady().then(() => {
  const config = readConfig();
  configureAutostart(config.autostart !== false);
  configureAutoUpdater();
  createMainWindow();
  createMenu();

  if (!config.selectedPrinter) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(openPrinterSettings, 700);
    });
  }

  if (app.isPackaged) {
    setTimeout(() => checkForUpdates(false), 10000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
