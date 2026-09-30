/**
 * Main process for Weight Capture Service
 * Lightweight Electron app that bridges weight scale data to web applications
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// Import modules
const SerialManager = require('./src/serial-manager');
const { HttpWeightServer } = require('./src/http-server');

// Configuration
const CONFIG = {
  WEB_APP_URL: process.env.WEB_APP_URL || 'http://localhost:3000',
  HTTP_SERVER_PORT: process.env.HTTP_SERVER_PORT || 8080,
};

// Global variables
let mainWindow = null;
let tray = null;
let serialManager = null;
let serialManagers = {};
let httpWeightServer = null;
let isAppReady = false;

// Check if app is already running
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

/**
 * Create the main window
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 600,
    minWidth: 380,
    minHeight: 520,
    frame: false, // Frameless custom window (Discord style)
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    autoHideMenuBar: true,
    icon: fs.existsSync(path.join(__dirname, 'assets/sobifruits.png'))
      ? path.join(__dirname, 'assets/sobifruits.png')
      : path.join(__dirname, 'assets/logo.ico'),
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    title: 'Sistema de Conexión de Balanza',
  });

  // Make main window globally accessible
  global.mainWindow = mainWindow;

  // Load the main UI
  mainWindow.loadFile('src/index.html');

  // Handle window events
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-state', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-state', false);
    }
  });

  // Handle minimize to tray
  mainWindow.on('minimize', (event) => {
    if (tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('close', (event) => {
    if (tray && !app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}

/**
 * Create system tray
 */
function createTray() {
  const iconPath = fs.existsSync(path.join(__dirname, 'assets/sobifruits.png'))
    ? path.join(__dirname, 'assets/sobifruits.png')
    : path.join(__dirname, 'assets/logo.ico');

  try {
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Mostrar Conector de Balanza',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Estado Balanza',
        enabled: false,
        sublabel: serialManager
          ? serialManager.isConnected
            ? 'Conectada'
            : 'Desconectada'
          : 'No inicializado',
      },
      {
        label: 'Servicio Web HTTP',
        enabled: false,
        sublabel: httpWeightServer ? 'Activo en :8080' : 'Detenido',
      },
      { type: 'separator' },
      {
        label: 'Cerrar Conector',
        click: () => {
          app.isQuiting = true;
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip('Conector de Balanza - Sobifruits');

    // Double click to show window
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (error) {
    console.warn('Could not create tray icon:', error.message);
  }
}

/**
 * Update tray menu with current status
 */
function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Weight Capture Service',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Serial Status',
      enabled: false,
      sublabel: serialManager
        ? serialManager.isConnected
          ? 'Connected'
          : 'Disconnected'
        : 'Not initialized',
    },
    {
      label: 'HTTP Server Status',
      enabled: false,
      sublabel: httpWeightServer ? 'Running on :8080' : 'Not initialized',
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Initialize the application
 */
async function initializeApp() {
  try {
    console.log('Initializing Weight Capture Service...');

    // Initialize dual serial managers: one for truck-1, one for truck-2
    serialManagers = {
      'truck-1': new SerialManager('truck-1'),
      'truck-2': new SerialManager('truck-2'),
    };
    serialManager = serialManagers['truck-1']; // Fallback for backwards-compatibility

    // Initialize HTTP weight server with both managers
    httpWeightServer = new HttpWeightServer({ serialManagers, serialManager });
    await httpWeightServer.start();

    // Wire events for each truck channel independently
    Object.entries(serialManagers).forEach(([truckId, mgr]) => {
      mgr.setAutoReconnect(false);

      mgr.on('weight', (data) => {
        if (httpWeightServer) {
          httpWeightServer.updateWeight(truckId, data.value);
          httpWeightServer.setConnectionStatus(truckId, true);
        }

        // Update main window
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('weight-update', { ...data, truckId });
        }
      });

      mgr.on('connected', (port) => {
        console.log(`[${truckId}] Serial connected: ${port}`);
        updateTrayMenu();

        if (httpWeightServer) {
          httpWeightServer.setConnectionStatus(truckId, true);
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('serial-status', { connected: true, port, truckId });
        }
      });

      mgr.on('disconnected', () => {
        console.log(`[${truckId}] Serial disconnected`);
        updateTrayMenu();

        if (httpWeightServer) {
          httpWeightServer.setConnectionStatus(truckId, false);
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('serial-status', { connected: false, truckId });
        }
      });

      mgr.on('error', (error) => {
        console.error(`[${truckId}] Serial error:`, error);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('serial-error', { error, truckId });
        }
      });
    });

    // Create main window
    const window = createMainWindow();

    // Create tray
    createTray();

    // Show window
    window.show();

    isAppReady = true;
    console.log('Weight Capture Service initialized successfully');
  } catch (error) {
    console.error('Failed to initialize app:', error);
    dialog.showErrorBox(
      'Initialization Error',
      `Failed to initialize Weight Capture Service: ${error.message}`
    );
    app.quit();
  }
}

// App event handlers
app.whenReady().then(async () => {
  await initializeApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  app.isQuiting = true;

  // Cleanup all serial managers
  for (const mgr of Object.values(serialManagers)) {
    mgr.stopAutoScan();
    await mgr.disconnect();
  }

  if (httpWeightServer) {
    await httpWeightServer.stop();
  }
});

// Test Weight Handler
ipcMain.handle('simulate-weight', async (event, weight, truckId = 'truck-1') => {
  if (!httpWeightServer) {
    throw new Error('HTTP weight server not initialized');
  }

  httpWeightServer.updateWeight(truckId, weight, true);
  console.log(`Manual weight simulated for ${truckId}: ${weight}kg`);

  return { success: true, weight, truckId };
});

// Custom Window Control Handlers (Discord style)
ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
  return true;
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  }
  return false;
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
  return true;
});

ipcMain.handle('is-window-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// IPC Handlers
ipcMain.handle('get-app-status', () => {
  const channels = {};
  for (const [id, mgr] of Object.entries(serialManagers)) {
    channels[id] = {
      connected: mgr ? mgr.isConnected : false,
      port: mgr ? mgr.currentPort : null,
      savedPort: mgr ? mgr.savedPort : null,
    };
  }

  return {
    isReady: isAppReady,
    channels,
    serial: channels['truck-1'] || { connected: false, port: null },
    httpServer: {
      running: httpWeightServer ? true : false,
      port: 8080,
      url: 'http://localhost:8080',
    },
  };
});

ipcMain.handle('list-serial-ports', async () => {
  const primaryMgr = serialManagers['truck-1'] || serialManager;
  if (!primaryMgr)
    return { success: false, error: 'Serial manager not initialized' };

  try {
    const ports = await primaryMgr.listPorts();
    return { success: true, ports };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('connect-serial-port', async (event, portPath, truckId = 'truck-1') => {
  const mgr = serialManagers[truckId] || serialManager;
  if (!mgr)
    return { success: false, error: `Serial manager para ${truckId} no inicializado` };

  try {
    const result = await mgr.connect(portPath);
    updateTrayMenu();
    return { success: result, truckId, port: portPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect-serial-port', async (event, truckId = 'truck-1') => {
  const mgr = serialManagers[truckId] || serialManager;
  if (!mgr)
    return { success: false, error: `Serial manager para ${truckId} no inicializado` };

  try {
    const result = await mgr.disconnect();
    updateTrayMenu();
    return { success: result, truckId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reset-serial-hardware', async (event, truckId = 'truck-1') => {
  const mgr = serialManagers[truckId] || serialManager;
  if (!mgr)
    return { success: false, error: `Serial manager para ${truckId} no inicializado` };

  try {
    const result = await mgr.resetHardware();
    return { success: result, truckId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-http-server-info', () => {
  return {
    port: 8080,
    url: 'http://localhost:8080',
    running: httpWeightServer ? true : false,
  };
});

// Handle second instance
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
