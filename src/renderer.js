/**
 * Renderer script for Weight Capture Service UI - Sobifruits
 * Supports Operator (User) Mode and PIN-Protected Technical Support Mode
 */

const { ipcRenderer } = require('electron');

// Global state
let currentWeight = 0;
let serialConnected = false;
let currentPortPath = null;
let currentMode = 'operator'; // 'operator' | 'support'
let logEntries = [];

// DOM Elements
let weightValueEl, weightMetaEl;
let serialStatusEl, serialStatusTextEl;
let httpServerStatusEl, httpStatusTextEl;
let serialPortSelect, refreshPortsBtn, connectBtn, disconnectBtn;
let testWeightInput, sendTestWeightBtn;
let clientCountEl, clientsListEl, httpServerInfoEl;
let activityLogEl, clearLogBtn;

// Mode & PIN Elements
let modeToggleBtn, modeToggleText;
let viewOperator, viewSupport, exitSupportBtn;
let pinModal, pinInput, pinError, pinCancelBtn;
let newPinInput, confirmPinInput, savePinBtn, pinUpdateMsg;

/**
 * Initialize the application
 */
document.addEventListener('DOMContentLoaded', async () => {
  initializeElements();
  setupEventListeners();
  setupTabNavigation();
  await initializeData();
  startPeriodicUpdates();
});

/**
 * Initialize DOM element references
 */
function initializeElements() {
  // Hero Weight
  weightValueEl = document.getElementById('weightValue');
  weightMetaEl = document.getElementById('weightMeta');

  // Status badges
  serialStatusEl = document.getElementById('serialStatus');
  serialStatusTextEl = document.getElementById('serialStatusText');
  httpServerStatusEl = document.getElementById('httpServerStatus');
  httpStatusTextEl = document.getElementById('httpStatusText');

  // Connection controls
  serialPortSelect = document.getElementById('serialPort');
  refreshPortsBtn = document.getElementById('refreshPortsBtn');
  connectBtn = document.getElementById('connectBtn');
  disconnectBtn = document.getElementById('disconnectBtn');

  // Support / Diagnostic elements
  testWeightInput = document.getElementById('testWeight');
  sendTestWeightBtn = document.getElementById('sendTestWeight');
  clientCountEl = document.getElementById('clientCount');
  clientsListEl = document.getElementById('clientsList');
  httpServerInfoEl = document.getElementById('httpServerInfo');
  activityLogEl = document.getElementById('activityLog');
  clearLogBtn = document.getElementById('clearLogBtn');

  // Mode switching & PIN modal
  modeToggleBtn = document.getElementById('modeToggleBtn');
  modeToggleText = document.getElementById('modeToggleText');
  viewOperator = document.getElementById('viewOperator');
  viewSupport = document.getElementById('viewSupport');
  exitSupportBtn = document.getElementById('exitSupportBtn');

  pinModal = document.getElementById('pinModal');
  pinInput = document.getElementById('pinInput');
  pinError = document.getElementById('pinError');
  pinCancelBtn = document.getElementById('pinCancelBtn');

  newPinInput = document.getElementById('newPinInput');
  confirmPinInput = document.getElementById('confirmPinInput');
  savePinBtn = document.getElementById('savePinBtn');
  pinUpdateMsg = document.getElementById('pinUpdateMsg');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Window controls (Discord style titlebar)
  const winMinimizeBtn = document.getElementById('winMinimizeBtn');
  const winMaximizeBtn = document.getElementById('winMaximizeBtn');
  const winCloseBtn = document.getElementById('winCloseBtn');
  const maximizeIcon = document.getElementById('maximizeIcon');

  if (winMinimizeBtn) {
    winMinimizeBtn.addEventListener('click', () => {
      ipcRenderer.invoke('window-minimize');
    });
  }

  if (winMaximizeBtn) {
    winMaximizeBtn.addEventListener('click', async () => {
      const isMax = await ipcRenderer.invoke('window-maximize');
      updateMaximizeIcon(isMax);
    });
  }

  if (winCloseBtn) {
    winCloseBtn.addEventListener('click', () => {
      ipcRenderer.invoke('window-close');
    });
  }

  ipcRenderer.on('window-maximized-state', (event, isMax) => {
    updateMaximizeIcon(isMax);
  });

  function updateMaximizeIcon(isMax) {
    if (!maximizeIcon) return;
    if (isMax) {
      maximizeIcon.innerHTML = `<path d="M2 0v2H0v8h8V8h2V0H2zm1 1h6v6H8V2H3V1zm-2 2h6v6H1V3z" fill="currentColor"/>`;
    } else {
      maximizeIcon.innerHTML = `<path d="M0 0v10h10V0H0zm1 1h8v8H1V1z" fill="currentColor"/>`;
    }
  }

  // Mode toggle (Header button)
  modeToggleBtn.addEventListener('click', () => {
    if (currentMode === 'operator') {
      openPinModal();
    } else {
      switchToOperatorMode();
    }
  });

  // Exit Support Mode button
  exitSupportBtn.addEventListener('click', () => {
    switchToOperatorMode();
  });

  // PIN modal cancel
  pinCancelBtn.addEventListener('click', () => {
    closePinModal();
  });

  // Close modal when clicking outside
  pinModal.addEventListener('click', (e) => {
    if (e.target === pinModal) {
      closePinModal();
    }
  });

  // Port selector change
  serialPortSelect.addEventListener('change', () => {
    const hasPort = Boolean(serialPortSelect.value);
    connectBtn.disabled = !hasPort || serialConnected;
    if (hasPort) {
      localStorage.setItem('sobifruits_saved_port', serialPortSelect.value);
    }
  });

  // Connection buttons
  connectBtn.addEventListener('click', connectToSerial);
  disconnectBtn.addEventListener('click', disconnectFromSerial);
  refreshPortsBtn.addEventListener('click', refreshSerialPorts);

  // Test weight emit
  if (sendTestWeightBtn) {
    sendTestWeightBtn.addEventListener('click', async () => {
      const weight = parseFloat(testWeightInput.value);
      if (isNaN(weight) || weight < 0) {
        addLogEntry('error', 'Por favor ingrese un valor de peso válido.');
        return;
      }

      try {
        sendTestWeightBtn.disabled = true;
        await ipcRenderer.invoke('simulate-weight', weight);
        addLogEntry('success', `Simulación emitida: ${weight.toFixed(1)} kg`);
      } catch (err) {
        addLogEntry('error', `Error al emitir peso simulado: ${err.message}`);
      } finally {
        setTimeout(() => {
          sendTestWeightBtn.disabled = false;
        }, 300);
      }
    });
  }

  // Clear log
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', clearLog);
  }

  // Save new PIN
  if (savePinBtn) {
    savePinBtn.addEventListener('click', handleSaveNewPin);
  }

  // IPC Events from Electron Main Process
  ipcRenderer.on('weight-update', (event, data) => {
    updateWeight(data);
  });

  ipcRenderer.on('serial-status', (event, status) => {
    updateSerialStatus(status);
  });

  ipcRenderer.on('serial-error', (event, error) => {
    addLogEntry('error', `Error Serial: ${error}`);
  });

  ipcRenderer.on('client-connected', (event, clientInfo) => {
    addLogEntry('success', `Cliente web conectado desde ${clientInfo.ip || 'localhost'}`);
    updateClientsCount();
  });

  ipcRenderer.on('client-disconnected', (event, clientInfo) => {
    addLogEntry('info', `Cliente web desconectado: ${clientInfo.id}`);
    updateClientsCount();
  });
}

/**
 * Tab Navigation in Support View
 */
function setupTabNavigation() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      // Update active tab button
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active content
      document.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.remove('active');
      });
      const activeContent = document.getElementById(`tabContent-${target}`);
      if (activeContent) {
        activeContent.classList.add('active');
      }
    });
  });
}

/**
 * PIN Verification & Mode Switching
 */
function openPinModal() {
  pinInput.value = '';
  pinError.textContent = '';
  pinModal.classList.add('open');
  setTimeout(() => pinInput.focus(), 50);
}

function closePinModal() {
  pinModal.classList.remove('open');
  pinInput.value = '';
  pinError.textContent = '';
}

window.handlePinSubmit = function () {
  const enteredPin = pinInput.value.trim();
  const savedPin = localStorage.getItem('sobifruits_support_pin') || '1234';

  if (enteredPin === savedPin) {
    closePinModal();
    switchToSupportMode();
    addLogEntry('info', 'Acceso técnico concedido.');
  } else {
    pinError.textContent = 'PIN incorrecto.';
    pinInput.select();
  }
};

function switchToSupportMode() {
  currentMode = 'support';
  viewOperator.classList.remove('active');
  viewSupport.classList.add('active');
}

function switchToOperatorMode() {
  currentMode = 'operator';
  viewSupport.classList.remove('active');
  viewOperator.classList.add('active');
}

function handleSaveNewPin() {
  const p1 = newPinInput.value.trim();
  const p2 = confirmPinInput.value.trim();

  if (!p1 || p1.length < 4) {
    pinUpdateMsg.style.color = '#dc2626';
    pinUpdateMsg.textContent = 'El PIN debe tener al menos 4 dígitos.';
    return;
  }

  if (p1 !== p2) {
    pinUpdateMsg.style.color = '#dc2626';
    pinUpdateMsg.textContent = 'Los códigos PIN no coinciden.';
    return;
  }

  localStorage.setItem('sobifruits_support_pin', p1);
  pinUpdateMsg.style.color = '#059669';
  pinUpdateMsg.textContent = '✓ Clave PIN actualizada.';
  newPinInput.value = '';
  confirmPinInput.value = '';
  setTimeout(() => {
    if (pinUpdateMsg) pinUpdateMsg.textContent = '';
  }, 3000);
}

/**
 * Test weight preset helper
 */
window.setPresetWeight = function (val) {
  if (testWeightInput) {
    testWeightInput.value = val.toFixed(1);
    if (sendTestWeightBtn) {
      sendTestWeightBtn.click();
    }
  }
};

/**
 * Initialize data from Main process
 */
async function initializeData() {
  try {
    const status = await ipcRenderer.invoke('get-app-status');
    updateAppStatus(status);

    const httpInfo = await ipcRenderer.invoke('get-http-server-info');
    updateHttpServerInfo(httpInfo);

    await refreshSerialPorts();

    // Auto-select saved port if available
    const savedPort = localStorage.getItem('sobifruits_saved_port');
    if (savedPort && serialPortSelect) {
      const match = Array.from(serialPortSelect.options).find((opt) => opt.value === savedPort);
      if (match) {
        serialPortSelect.value = savedPort;
        connectBtn.disabled = serialConnected;
      }
    }

    addLogEntry('success', 'Conector de balanza inicializado correctamente.');
  } catch (error) {
    addLogEntry('error', `Error de inicio: ${error.message}`);
  }
}

/**
 * Periodic status refresh
 */
function startPeriodicUpdates() {
  setInterval(async () => {
    try {
      const status = await ipcRenderer.invoke('get-app-status');
      updateAppStatus(status);
    } catch (e) {
      // ignore
    }
  }, 5000);
}

/**
 * Update weight reading
 */
function updateWeight(data) {
  currentWeight = data.value;
  if (weightValueEl) {
    weightValueEl.textContent = Number(data.value).toFixed(1);
  }

  const timestamp = new Date(data.timestamp || Date.now()).toLocaleTimeString();
  if (weightMetaEl) {
    weightMetaEl.textContent = `Última lectura: ${timestamp} • En vivo`;
  }
}

/**
 * Update serial status
 */
function updateSerialStatus(status) {
  serialConnected = status.connected;
  currentPortPath = status.port || null;

  if (serialConnected) {
    if (serialStatusEl) serialStatusEl.className = 'status-badge connected';
    if (serialStatusTextEl) serialStatusTextEl.textContent = 'Balanza Conectada';
    if (connectBtn) connectBtn.style.display = 'none';
    if (disconnectBtn) {
      disconnectBtn.style.display = 'inline-flex';
      disconnectBtn.disabled = false;
    }
    if (weightMetaEl) {
      weightMetaEl.textContent = 'Transmitiendo en vivo al ERP';
    }
  } else {
    if (serialStatusEl) serialStatusEl.className = 'status-badge disconnected';
    if (serialStatusTextEl) serialStatusTextEl.textContent = 'Buscando balanza...';
    if (disconnectBtn) disconnectBtn.style.display = 'none';
    if (connectBtn) {
      connectBtn.style.display = 'inline-flex';
      connectBtn.disabled = !serialPortSelect || !serialPortSelect.value;
    }
    if (weightMetaEl) {
      weightMetaEl.textContent = 'Esperando conexión de balanza';
    }
  }
}

/**
 * Update overall app status
 */
function updateAppStatus(status) {
  if (status.serial) {
    updateSerialStatus(status.serial);
  }

  if (status.httpServer) {
    const isRunning = status.httpServer.running;
    if (httpServerStatusEl) {
      httpServerStatusEl.className = isRunning ? 'status-pill connected' : 'status-pill disconnected';
    }
    if (httpStatusTextEl) {
      httpStatusTextEl.textContent = isRunning ? `Servicio Web :${status.httpServer.port || 8080}` : 'Servicio Detenido';
    }
  }
}

function updateHttpServerInfo(httpInfo) {
  if (httpServerInfoEl) {
    httpServerInfoEl.textContent = httpInfo.url || 'http://localhost:8080';
  }
}

async function updateClientsCount() {
  try {
    const status = await ipcRenderer.invoke('get-app-status');
    if (status.httpServer && clientCountEl) {
      clientCountEl.textContent = status.httpServer.activeConnections || 1;
    }
  } catch (e) {
    // ignore
  }
}

/**
 * Serial connection actions
 */
async function connectToSerial() {
  if (!serialPortSelect || !serialPortSelect.value) return;
  const selectedPort = serialPortSelect.value;

  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.innerHTML = `<span>Conectando...</span>`;
  }

  try {
    const result = await ipcRenderer.invoke('connect-serial-port', selectedPort);
    if (result.success) {
      addLogEntry('success', `Conectado al puerto ${selectedPort}`);
    } else {
      addLogEntry('error', `Fallo de conexión: ${result.error}`);
      if (connectBtn) {
        connectBtn.disabled = false;
        connectBtn.innerHTML = `<span>Conectar Balanza</span>`;
      }
    }
  } catch (err) {
    addLogEntry('error', `Error al conectar: ${err.message}`);
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.innerHTML = `<span>Conectar Balanza</span>`;
    }
  }
}

async function disconnectFromSerial() {
  if (disconnectBtn) {
    disconnectBtn.disabled = true;
    disconnectBtn.innerHTML = `<span>Desconectando...</span>`;
  }

  try {
    const result = await ipcRenderer.invoke('disconnect-serial-port');
    if (result.success) {
      addLogEntry('info', 'Balanza desconectada.');
    } else {
      addLogEntry('error', `Error al desconectar: ${result.error}`);
    }
  } catch (err) {
    addLogEntry('error', `Error: ${err.message}`);
  } finally {
    if (disconnectBtn) {
      disconnectBtn.disabled = false;
      disconnectBtn.innerHTML = `<span>Desconectar</span>`;
    }
  }
}

async function refreshSerialPorts() {
  if (refreshPortsBtn) refreshPortsBtn.disabled = true;

  try {
    const result = await ipcRenderer.invoke('list-serial-ports');
    if (result.success) {
      populateSerialPorts(result.ports);
      addLogEntry('info', `Puertos COM detectados: ${result.ports.length}`);
    } else {
      addLogEntry('error', `Error al listar puertos: ${result.error}`);
    }
  } catch (err) {
    addLogEntry('error', `Error al refrescar puertos: ${err.message}`);
  } finally {
    if (refreshPortsBtn) refreshPortsBtn.disabled = false;
  }
}

function populateSerialPorts(ports) {
  if (!serialPortSelect) return;
  serialPortSelect.innerHTML = '<option value="">Seleccione un puerto...</option>';

  ports.forEach((port) => {
    const option = document.createElement('option');
    option.value = port.path;
    const label = port.friendlyName || port.manufacturer ? `${port.path} (${port.friendlyName || port.manufacturer})` : port.path;
    option.textContent = label;
    serialPortSelect.appendChild(option);
  });

  const savedPort = localStorage.getItem('sobifruits_saved_port');
  if (savedPort && ports.some((p) => p.path === savedPort)) {
    serialPortSelect.value = savedPort;
  } else if (ports.length > 0) {
    serialPortSelect.value = ports[0].path;
    localStorage.setItem('sobifruits_saved_port', ports[0].path);
  }

  if (connectBtn) {
    connectBtn.disabled = !serialPortSelect.value || serialConnected;
  }

  // Auto-connect to detected scale port in background
  if (!serialConnected && serialPortSelect.value) {
    connectToSerial();
  }
}

/**
 * Activity Logging
 */
function addLogEntry(level, message) {
  const timestamp = new Date().toLocaleTimeString();
  logEntries.push({ timestamp, level, message });

  if (logEntries.length > 150) {
    logEntries.shift();
  }

  updateLogDisplay();
}

function updateLogDisplay() {
  if (!activityLogEl) return;

  const html = logEntries
    .map((e) => {
      const tagClass = `log-tag-${e.level}`;
      return `
        <div class="log-entry">
          <span class="log-time">[${e.timestamp}]</span>
          <span class="log-tag ${tagClass}">[${e.level.toUpperCase()}]</span>
          <span class="log-msg">${e.message}</span>
        </div>
      `;
    })
    .join('');

  activityLogEl.innerHTML = html;
  activityLogEl.scrollTop = activityLogEl.scrollHeight;
}

function clearLog() {
  logEntries = [];
  if (activityLogEl) activityLogEl.innerHTML = '';
  addLogEntry('info', 'Consola de registros limpia.');
}
