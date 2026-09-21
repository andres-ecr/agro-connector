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
    pinError.textContent = 'PIN incorrecto. Ingrese el código de soporte.';
    pinInput.select();
  }
};

function switchToSupportMode() {
  currentMode = 'support';
  viewOperator.classList.remove('active');
  viewSupport.classList.add('active');
  modeToggleText.textContent = 'Modo Operador';
}

function switchToOperatorMode() {
  currentMode = 'operator';
  viewSupport.classList.remove('active');
  viewOperator.classList.add('active');
  modeToggleText.textContent = 'Soporte Técnico';
}

function handleSaveNewPin() {
  const p1 = newPinInput.value.trim();
  const p2 = confirmPinInput.value.trim();

  if (!p1 || p1.length < 4) {
    pinUpdateMsg.style.color = 'var(--danger-dot)';
    pinUpdateMsg.textContent = 'El PIN debe tener al menos 4 dígitos.';
    return;
  }

  if (p1 !== p2) {
    pinUpdateMsg.style.color = 'var(--danger-dot)';
    pinUpdateMsg.textContent = 'Los PIN no coinciden.';
    return;
  }

  localStorage.setItem('sobifruits_support_pin', p1);
  pinUpdateMsg.style.color = 'var(--success-text)';
  pinUpdateMsg.textContent = '✓ PIN actualizado con éxito.';
  newPinInput.value = '';
  confirmPinInput.value = '';
  setTimeout(() => {
    pinUpdateMsg.textContent = '';
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
  weightValueEl.textContent = Number(data.value).toFixed(1);

  const timestamp = new Date(data.timestamp || Date.now()).toLocaleTimeString();
  const portLabel = data.port || currentPortPath || 'Activo';
  weightMetaEl.innerHTML = `
    <span>Última lectura: <strong>${timestamp}</strong></span>
    <span>•</span>
    <span>Puerto: <strong>${portLabel}</strong></span>
    <span>•</span>
    <span style="color: var(--success-text); font-weight: 600;">En Vivo</span>
  `;
}

/**
 * Update serial status
 */
function updateSerialStatus(status) {
  serialConnected = status.connected;
  currentPortPath = status.port || null;

  if (serialConnected) {
    serialStatusEl.className = 'status-pill connected';
    serialStatusTextEl.textContent = `Balanza: Conectada (${status.port || ''})`;
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'inline-flex';
    disconnectBtn.disabled = false;
  } else {
    serialStatusEl.className = 'status-pill disconnected';
    serialStatusTextEl.textContent = 'Balanza: Desconectada';
    disconnectBtn.style.display = 'none';
    connectBtn.style.display = 'inline-flex';
    connectBtn.disabled = !serialPortSelect.value;
    weightMetaEl.textContent = 'Balanza desconectada. Seleccione un puerto COM y conecte.';
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
    if (isRunning) {
      httpServerStatusEl.className = 'status-pill connected';
      httpStatusTextEl.textContent = `Servicio Web :${status.httpServer.port || 8080}`;
    } else {
      httpServerStatusEl.className = 'status-pill disconnected';
      httpStatusTextEl.textContent = 'Servicio Web: Detenido';
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
  const selectedPort = serialPortSelect.value;
  if (!selectedPort) return;

  connectBtn.disabled = true;
  connectBtn.innerHTML = `<span>Conectando...</span>`;

  try {
    const result = await ipcRenderer.invoke('connect-serial-port', selectedPort);
    if (result.success) {
      addLogEntry('success', `Conectado exitosamente al puerto ${selectedPort}`);
    } else {
      addLogEntry('error', `Fallo de conexión: ${result.error}`);
      connectBtn.disabled = false;
      connectBtn.innerHTML = `<span>Conectar Balanza</span>`;
    }
  } catch (err) {
    addLogEntry('error', `Error al conectar: ${err.message}`);
    connectBtn.disabled = false;
    connectBtn.innerHTML = `<span>Conectar Balanza</span>`;
  }
}

async function disconnectFromSerial() {
  disconnectBtn.disabled = true;
  disconnectBtn.innerHTML = `<span>Desconectando...</span>`;

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
    disconnectBtn.disabled = false;
    disconnectBtn.innerHTML = `<span>Desconectar</span>`;
  }
}

async function refreshSerialPorts() {
  refreshPortsBtn.disabled = true;

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
    refreshPortsBtn.disabled = false;
  }
}

function populateSerialPorts(ports) {
  serialPortSelect.innerHTML = '<option value="">Seleccione un puerto...</option>';

  ports.forEach((port) => {
    const option = document.createElement('option');
    option.value = port.path;
    const label = port.friendlyName || port.manufacturer ? `${port.path} - ${port.friendlyName || port.manufacturer}` : port.path;
    option.textContent = label;
    serialPortSelect.appendChild(option);
  });

  const savedPort = localStorage.getItem('sobifruits_saved_port');
  if (savedPort && ports.some((p) => p.path === savedPort)) {
    serialPortSelect.value = savedPort;
  }

  connectBtn.disabled = !serialPortSelect.value || serialConnected;
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
