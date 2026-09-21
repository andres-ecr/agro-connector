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
    width: 860,
    height: 680,
    minWidth: 680,
    minHeight: 520,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/logo.ico'),
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    title: 'Conector de Balanza - Sobifruits',
  });

  // Make main window globally accessible
  global.mainWindow = mainWindow;

  // Load the main UI
  mainWindow.loadFile('src/index.html');

  // Handle window events
  mainWindow.on('closed', () => {
    mainWindow = null;
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
  const iconPath = path.join(__dirname, 'assets/logo.ico');

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

    // Initialize serial manager
    serialManager = new SerialManager();

    // Initialize HTTP weight server
    httpWeightServer = new HttpWeightServer();
    await httpWeightServer.start();

    // Connect serial manager to HTTP server
    serialManager.on('weight', (data) => {
      // Send to both trucks by default, or route based on configuration
      const truckId = 'truck-1'; // Default to truck-1, can be made configurable

      if (httpWeightServer) {
        httpWeightServer.updateWeight(truckId, data.value);
        httpWeightServer.setConnectionStatus(truckId, true);
      }

      // Update main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('weight-update', data);
      }
    });

    serialManager.on('connected', (port) => {
      console.log(`Serial connected: ${port}`);
      updateTrayMenu();

      // Set connection status for all trucks
      if (httpWeightServer) {
        httpWeightServer.setConnectionStatus('truck-1', true);
        httpWeightServer.setConnectionStatus('truck-2', true);
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial-status', { connected: true, port });
      }
    });

    serialManager.on('disconnected', () => {
      console.log('Serial disconnected');
      updateTrayMenu();

      // Set connection status for all trucks
      if (httpWeightServer) {
        httpWeightServer.setConnectionStatus('truck-1', false);
        httpWeightServer.setConnectionStatus('truck-2', false);
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial-status', { connected: false });
      }
    });

    serialManager.on('error', (error) => {
      console.error('Serial error:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial-error', error);
      }
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

  // Cleanup
  if (serialManager) {
    await serialManager.disconnect();
  }

  if (httpWeightServer) {
    await httpWeightServer.stop();
  }
});

// Test Weight Handler
ipcMain.handle('simulate-weight', async (event, weight) => {
  if (!httpWeightServer) {
    throw new Error('HTTP weight server not initialized');
  }

  // Send to truck-1 by default, can be made configurable
  httpWeightServer.updateWeight('truck-1', weight);
  console.log(`Manual weight simulated: ${weight}kg for truck-1`);

  return { success: true, weight, truckId: 'truck-1' };
});

// IPC Handlers
ipcMain.handle('get-app-status', () => {
  return {
    isReady: isAppReady,
    serial: {
      connected: serialManager ? serialManager.isConnected : false,
      port: serialManager ? serialManager.currentPort : null,
    },
    httpServer: {
      running: httpWeightServer ? true : false,
      port: 8080,
      url: 'http://localhost:8080',
    },
  };
});

ipcMain.handle('list-serial-ports', async () => {
  if (!serialManager)
    return { success: false, error: 'Serial manager not initialized' };

  try {
    const ports = await serialManager.listPorts();
    return { success: true, ports };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('connect-serial-port', async (event, portPath) => {
  if (!serialManager)
    return { success: false, error: 'Serial manager not initialized' };

  try {
    const result = await serialManager.connect(portPath);
    updateTrayMenu();
    return { success: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect-serial-port', async () => {
  if (!serialManager)
    return { success: false, error: 'Serial manager not initialized' };

  try {
    const result = await serialManager.disconnect();
    updateTrayMenu();
    return { success: result };
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
