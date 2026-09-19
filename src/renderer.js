/**
 * Renderer script for Weight Capture Service UI
 */

const { ipcRenderer } = require('electron');

// Global state
let currentWeight = 0;
let serialConnected = false;
let connectedClients = [];
let logEntries = [];

// DOM elements
let weightValueEl, weightMetaEl, serialStatusEl, httpServerStatusEl;
let testWeightInput, sendTestWeightBtn;
let serialPortSelect, connectBtn, disconnectBtn, refreshPortsBtn;
let clientCountEl, clientsListEl, activityLogEl, clearLogBtn;
let httpServerInfoEl;

/**
 * Initialize the application
 */
document.addEventListener('DOMContentLoaded', async () => {
  initializeElements();
  setupEventListeners();
  await initializeData();
  startPeriodicUpdates();
});

/**
 * Initialize DOM element references
 */
function initializeElements() {
  weightValueEl = document.getElementById('weightValue');
  weightMetaEl = document.getElementById('weightMeta');
  serialStatusEl = document.getElementById('serialStatus');
  httpServerStatusEl = document.getElementById('httpServerStatus');
  serialPortSelect = document.getElementById('serialPort');
  connectBtn = document.getElementById('connectBtn');
  disconnectBtn = document.getElementById('disconnectBtn');
  refreshPortsBtn = document.getElementById('refreshPortsBtn');
  clientCountEl = document.getElementById('clientCount');
  clientsListEl = document.getElementById('clientsList');
  activityLogEl = document.getElementById('activityLog');
  clearLogBtn = document.getElementById('clearLogBtn');
  httpServerInfoEl = document.getElementById('httpServerInfo');

  // Test elements
  testWeightInput = document.getElementById('testWeight');
  sendTestWeightBtn = document.getElementById('sendTestWeight');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Test weight events
  if (sendTestWeightBtn) {
    // Ensure the button is always enabled for manual testing
    sendTestWeightBtn.disabled = false;

    sendTestWeightBtn.addEventListener('click', async () => {
      const weight = parseFloat(testWeightInput.value);
      if (isNaN(weight) || weight <= 0) {
        addLogEntry('error', 'Por favor ingrese un peso válido mayor a 0');
        return;
      }

      try {
        // Temporarily disable button to prevent double-clicks
        sendTestWeightBtn.disabled = true;

        await ipcRenderer.invoke('simulate-weight', weight);
        addLogEntry(
          'success',
          `Peso de prueba enviado: ${weight.toFixed(1)} kg para truck-1`
        );

        // Clear the input after successful send
        testWeightInput.value = '';
      } catch (error) {
        addLogEntry(
          'error',
          `Error al enviar peso de prueba: ${error.message}`
        );
      } finally {
        // Re-enable button after operation
        setTimeout(() => {
          sendTestWeightBtn.disabled = false;
        }, 500);
      }
    });
  }

  // Serial port events
  serialPortSelect.addEventListener('change', () => {
    connectBtn.disabled = !serialPortSelect.value;
  });

  connectBtn.addEventListener('click', connectToSerial);
  disconnectBtn.addEventListener('click', disconnectFromSerial);
  refreshPortsBtn.addEventListener('click', refreshSerialPorts);

  // Log events
  clearLogBtn.addEventListener('click', clearLog);

  // IPC events from main process
  ipcRenderer.on('weight-update', (event, data) => {
    updateWeight(data);
  });

  ipcRenderer.on('serial-status', (event, status) => {
    updateSerialStatus(status);
  });

  ipcRenderer.on('serial-error', (event, error) => {
    addLogEntry('error', `Serial Error: ${error}`);
  });

  ipcRenderer.on('client-connected', (event, clientInfo) => {
    addLogEntry(
      'success',
      `Web client connected: ${clientInfo.id} from ${clientInfo.ip}`
    );
    updateClients();
  });

  ipcRenderer.on('client-disconnected', (event, clientInfo) => {
    addLogEntry('info', `Web client disconnected: ${clientInfo.id}`);
    updateClients();
  });
}

/**
 * Initialize data from main process
 */
async function initializeData() {
  try {
    // Get app status
    const status = await ipcRenderer.invoke('get-app-status');
    updateAppStatus(status);

    // Get HTTP Server info
    const httpInfo = await ipcRenderer.invoke('get-http-server-info');
    updateHttpServerInfo(httpInfo);

    // Refresh serial ports
    await refreshSerialPorts();

    // Ensure test weight button is always enabled for manual testing
    if (sendTestWeightBtn) {
      sendTestWeightBtn.disabled = false;
    }

    addLogEntry('success', 'Weight Capture Service initialized');
  } catch (error) {
    addLogEntry('error', `Initialization error: ${error.message}`);
  }
}

/**
 * Start periodic updates
 */
function startPeriodicUpdates() {
  // Update app status every 5 seconds
  setInterval(async () => {
    try {
      const status = await ipcRenderer.invoke('get-app-status');
      updateAppStatus(status);
    } catch (error) {
      console.error('Error updating status:', error);
    }
  }, 5000);
}

/**
 * Update weight display
 */
function updateWeight(data) {
  currentWeight = data.value;

  weightValueEl.textContent = `${data.value.toFixed(1)} kg`;

  const timestamp = new Date(data.timestamp).toLocaleTimeString();
  weightMetaEl.textContent = `Last update: ${timestamp} | Port: ${
    data.port || 'N/A'
  }`;

  addLogEntry('info', `Weight: ${data.value.toFixed(1)} kg`);
}

/**
 * Update serial connection status
 */
function updateSerialStatus(status) {
  serialConnected = status.connected;

  if (serialConnected) {
    serialStatusEl.className = 'status-indicator connected';
    serialStatusEl.innerHTML = `
            <div class="status-dot"></div>
            <span>Serial: Connected (${status.port})</span>
        `;
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    addLogEntry('success', `Serial connected to ${status.port}`);
  } else {
    serialStatusEl.className = 'status-indicator disconnected';
    serialStatusEl.innerHTML = `
            <div class="status-dot"></div>
            <span>Serial: Disconnected</span>
        `;
    connectBtn.disabled = !serialPortSelect.value;
    disconnectBtn.disabled = true;
    if (status.port) {
      addLogEntry('warning', 'Serial disconnected');
    }
  }
}

/**
 * Update app status
 */
function updateAppStatus(status) {
  // Update serial status
  if (status.serial) {
    updateSerialStatus(status.serial);
  }

  // Update HTTP Server status
  if (status.httpServer) {
    const serverConnected = status.httpServer.running;
    clientCountEl.textContent = status.httpServer.activeConnections || 0;

    if (serverConnected) {
      httpServerStatusEl.className = 'status-indicator connected';
      httpServerStatusEl.innerHTML = `
                <div class="status-dot"></div>
                <span>HTTP Server: Active (Port ${status.httpServer.port})</span>
            `;
    } else {
      httpServerStatusEl.className = 'status-indicator disconnected';
      httpServerStatusEl.innerHTML = `
                <div class="status-dot"></div>
                <span>HTTP Server: Stopped</span>
            `;
    }
  }
}

/**
 * Update HTTP Server info
 */
function updateHttpServerInfo(httpInfo) {
  httpServerInfoEl.textContent = httpInfo.url || 'http://localhost:8080';
  clientCountEl.textContent = httpInfo.activeConnections || 0;
}

/**
 * Update clients list
 */
async function updateClients() {
  try {
    const status = await ipcRenderer.invoke('get-app-status');
    // This would need to be implemented in main.js to return client details
    // For now, just update the count
    if (status.httpServer) {
      clientCountEl.textContent = status.httpServer.activeConnections || 0;
    }
  } catch (error) {
    console.error('Error updating clients:', error);
  }
}

/**
 * Connect to serial port
 */
async function connectToSerial() {
  const selectedPort = serialPortSelect.value;
  if (!selectedPort) return;

  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';

  try {
    const result = await ipcRenderer.invoke(
      'connect-serial-port',
      selectedPort
    );

    if (result.success) {
      addLogEntry('success', `Connected to ${selectedPort}`);
    } else {
      addLogEntry('error', `Failed to connect: ${result.error}`);
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
    }
  } catch (error) {
    addLogEntry('error', `Connection error: ${error.message}`);
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
  }
}

/**
 * Disconnect from serial port
 */
async function disconnectFromSerial() {
  disconnectBtn.disabled = true;
  disconnectBtn.textContent = 'Disconnecting...';

  try {
    const result = await ipcRenderer.invoke('disconnect-serial-port');

    if (result.success) {
      addLogEntry('info', 'Serial port disconnected');
    } else {
      addLogEntry('error', `Failed to disconnect: ${result.error}`);
    }
  } catch (error) {
    addLogEntry('error', `Disconnection error: ${error.message}`);
  } finally {
    disconnectBtn.disabled = false;
    disconnectBtn.textContent = 'Disconnect';
  }
}

/**
 * Refresh available serial ports
 */
async function refreshSerialPorts() {
  refreshPortsBtn.disabled = true;
  refreshPortsBtn.textContent = 'Refreshing...';

  try {
    const result = await ipcRenderer.invoke('list-serial-ports');

    if (result.success) {
      populateSerialPorts(result.ports);
      addLogEntry('info', `Found ${result.ports.length} serial ports`);
    } else {
      addLogEntry('error', `Failed to list ports: ${result.error}`);
    }
  } catch (error) {
    addLogEntry('error', `Error listing ports: ${error.message}`);
  } finally {
    refreshPortsBtn.disabled = false;
    refreshPortsBtn.textContent = 'Refresh Ports';
  }
}

/**
 * Populate serial ports dropdown
 */
function populateSerialPorts(ports) {
  // Clear existing options except the first one
  serialPortSelect.innerHTML = '<option value="">Select a port...</option>';

  ports.forEach((port) => {
    const option = document.createElement('option');
    option.value = port.path;
    option.textContent = `${port.path} - ${
      port.friendlyName || port.manufacturer || 'Unknown'
    }`;
    serialPortSelect.appendChild(option);
  });

  // Enable connect button if a port is selected
  connectBtn.disabled = !serialPortSelect.value;
}

/**
 * Add entry to activity log
 */
function addLogEntry(level, message) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = {
    timestamp,
    level,
    message,
  };

  logEntries.push(entry);

  // Keep only last 100 entries
  if (logEntries.length > 100) {
    logEntries.shift();
  }

  updateLogDisplay();
}

/**
 * Update log display
 */
function updateLogDisplay() {
  const logHtml = logEntries
    .map((entry) => {
      return `<div class="log-entry">
            <span class="log-timestamp">[${entry.timestamp}]</span>
            <span class="log-level-${
              entry.level
            }">[${entry.level.toUpperCase()}]</span>
            ${entry.message}
        </div>`;
    })
    .join('');

  activityLogEl.innerHTML = logHtml;

  // Auto-scroll to bottom
  activityLogEl.scrollTop = activityLogEl.scrollHeight;
}

/**
 * Clear activity log
 */
function clearLog() {
  logEntries = [];
  activityLogEl.innerHTML = '';
  addLogEntry('info', 'Activity log cleared');
}

/**
 * Format file size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
