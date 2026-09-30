/**
 * Renderer script for Weight Capture Service UI - Sobifruits
 * Supports Operator (User) Mode and PIN-Protected Technical Support Mode
 */

const { ipcRenderer } = require('electron');

// Global state
let activeChannel = 'truck-1'; // 'truck-1' | 'truck-2'
let channels = {
  'truck-1': {
    weight: 0,
    connected: false,
    port: null,
    savedPort: localStorage.getItem('sobifruits_saved_port_truck-1') || localStorage.getItem('sobifruits_saved_port') || null,
  },
  'truck-2': {
    weight: 0,
    connected: false,
    port: null,
    savedPort: localStorage.getItem('sobifruits_saved_port_truck-2') || null,
  },
};
let detectedPorts = [];
let currentWeight = 0;
let serialConnected = false;
let currentPortPath = null;
let currentMode = 'operator'; // 'operator' | 'support'
let logEntries = [];

// DOM Elements
let btnChannelTruck1, btnChannelTruck2;
let opPortCardLabel, weightHeroLabel;
let weightValueEl, weightMetaEl;
let serialStatusEl, serialStatusTextEl;
let httpServerStatusEl, httpStatusTextEl;

// Support View Connection Controls
let serialPortSelect, refreshPortsBtn, connectBtn, disconnectBtn;

// Operator View Direct Connection Controls
let opSerialPortSelect, opRefreshPortsBtn, opConnectBtn, opDisconnectBtn;

// Support / Diagnostic elements
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
  // Channel Tabs & Dynamic Labels
  btnChannelTruck1 = document.getElementById('btnChannelTruck1');
  btnChannelTruck2 = document.getElementById('btnChannelTruck2');
  opPortCardLabel = document.getElementById('opPortCardLabel');
  weightHeroLabel = document.getElementById('weightHeroLabel');

  // Hero Weight
  weightValueEl = document.getElementById('weightValue');
  weightMetaEl = document.getElementById('weightMeta');

  // Status badges
  serialStatusEl = document.getElementById('serialStatus');
  serialStatusTextEl = document.getElementById('serialStatusText');
  httpServerStatusEl = document.getElementById('httpServerStatus');
  httpStatusTextEl = document.getElementById('httpStatusText');

  // Operator view controls
  opSerialPortSelect = document.getElementById('opSerialPort');
  opRefreshPortsBtn = document.getElementById('opRefreshPortsBtn');
  opConnectBtn = document.getElementById('opConnectBtn');
  opDisconnectBtn = document.getElementById('opDisconnectBtn');

  // Support view connection controls
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

  // Channel Tabs (Balanza 1 / Balanza 2)
  if (btnChannelTruck1) {
    btnChannelTruck1.addEventListener('click', () => switchChannel('truck-1'));
  }
  if (btnChannelTruck2) {
    btnChannelTruck2.addEventListener('click', () => switchChannel('truck-2'));
  }

  // Sync operator port selector change
  if (opSerialPortSelect) {
    opSerialPortSelect.addEventListener('change', () => {
      const val = opSerialPortSelect.value;
      if (serialPortSelect) serialPortSelect.value = val;
      if (channels[activeChannel]) {
        channels[activeChannel].savedPort = val || null;
      }
      const isConnected = channels[activeChannel]?.connected || false;
      const hasPort = Boolean(val);
      if (opConnectBtn) opConnectBtn.disabled = !hasPort || isConnected;
      if (connectBtn) connectBtn.disabled = !hasPort || isConnected;
      if (hasPort) {
        localStorage.setItem(`sobifruits_saved_port_${activeChannel}`, val);
        if (activeChannel === 'truck-1') {
          localStorage.setItem('sobifruits_saved_port', val);
        }
      }
    });
  }

  // Sync support port selector change
  if (serialPortSelect) {
    serialPortSelect.addEventListener('change', () => {
      const val = serialPortSelect.value;
      if (opSerialPortSelect) opSerialPortSelect.value = val;
      if (channels[activeChannel]) {
        channels[activeChannel].savedPort = val || null;
      }
      const isConnected = channels[activeChannel]?.connected || false;
      const hasPort = Boolean(val);
      if (opConnectBtn) opConnectBtn.disabled = !hasPort || isConnected;
      if (connectBtn) connectBtn.disabled = !hasPort || isConnected;
      if (hasPort) {
        localStorage.setItem(`sobifruits_saved_port_${activeChannel}`, val);
        if (activeChannel === 'truck-1') {
          localStorage.setItem('sobifruits_saved_port', val);
        }
      }
    });
  }

  // Connection buttons (Operator View)
  if (opConnectBtn) opConnectBtn.addEventListener('click', () => connectToSerial());
  if (opDisconnectBtn) opDisconnectBtn.addEventListener('click', disconnectFromSerial);
  if (opRefreshPortsBtn) opRefreshPortsBtn.addEventListener('click', refreshSerialPorts);

  // Connection buttons (Support View)
  if (connectBtn) connectBtn.addEventListener('click', () => connectToSerial());
  if (disconnectBtn) disconnectBtn.addEventListener('click', disconnectFromSerial);
  if (refreshPortsBtn) refreshPortsBtn.addEventListener('click', refreshSerialPorts);

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
        await ipcRenderer.invoke('simulate-weight', weight, activeChannel);
        const balLabel = activeChannel === 'truck-1' ? 'Balanza 1 (Camión 1)' : 'Balanza 2 (Camión 2)';
        addLogEntry('success', `Simulación emitida para ${balLabel}: ${weight.toFixed(1)} kg`);
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

      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

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

/**
 * Switch active scale channel (truck-1 vs truck-2)
 */
function switchChannel(channelId) {
  if (activeChannel === channelId) return;
  activeChannel = channelId;

  if (btnChannelTruck1) {
    btnChannelTruck1.classList.toggle('active', activeChannel === 'truck-1');
  }
  if (btnChannelTruck2) {
    btnChannelTruck2.classList.toggle('active', activeChannel === 'truck-2');
  }

  const label = activeChannel === 'truck-1' ? 'Balanza 1 (Camión 1)' : 'Balanza 2 (Camión 2)';
  if (weightHeroLabel) {
    weightHeroLabel.textContent = `Lectura ${label}`;
  }
  if (opPortCardLabel) {
    opPortCardLabel.textContent = `Puerto COM ${label}`;
  }

  renderActiveChannel();
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
  const truckId = data.truckId || 'truck-1';
  if (channels[truckId]) {
    channels[truckId].weight = data.value;
    channels[truckId].timestamp = data.timestamp;
  }

  if (truckId === activeChannel) {
    currentWeight = data.value;
    if (weightValueEl) {
      weightValueEl.textContent = Number(data.value).toFixed(1);
    }

    const timestamp = new Date(data.timestamp || Date.now()).toLocaleTimeString();
    if (weightMetaEl) {
      weightMetaEl.textContent = `Última lectura: ${timestamp} • En vivo`;
    }
  }
}

/**
 * Render UI for currently active channel
 */
function renderActiveChannel() {
  const ch = channels[activeChannel] || { weight: 0, connected: false, port: null };
  const channelName = activeChannel === 'truck-1' ? 'Balanza 1 (Camión 1)' : 'Balanza 2 (Camión 2)';

  // 1. Update Weight
  if (weightValueEl) {
    weightValueEl.textContent = Number(ch.weight || 0).toFixed(1);
  }

  // 2. Update Status badge & Connection buttons
  if (ch.connected) {
    if (serialStatusEl) serialStatusEl.className = 'status-badge connected';
    if (serialStatusTextEl) {
      serialStatusTextEl.textContent = ch.port ? `${channelName} Conectada (${ch.port})` : `${channelName} Conectada`;
    }

    if (connectBtn) connectBtn.style.display = 'none';
    if (disconnectBtn) {
      disconnectBtn.style.display = 'inline-flex';
      disconnectBtn.disabled = false;
      disconnectBtn.innerHTML = '<span>Desconectar</span>';
    }

    if (opConnectBtn) opConnectBtn.style.display = 'none';
    if (opDisconnectBtn) {
      opDisconnectBtn.style.display = 'inline-flex';
      opDisconnectBtn.disabled = false;
      opDisconnectBtn.innerHTML = '<span>Desconectar</span>';
    }

    if (weightMetaEl) {
      weightMetaEl.textContent = 'Transmitiendo en vivo al ERP';
    }
  } else {
    if (serialStatusEl) serialStatusEl.className = 'status-badge disconnected';
    if (serialStatusTextEl) {
      serialStatusTextEl.textContent = `${channelName} Desconectada`;
    }

    if (disconnectBtn) disconnectBtn.style.display = 'none';
    if (connectBtn) {
      connectBtn.style.display = 'inline-flex';
      connectBtn.disabled = !opSerialPortSelect || !opSerialPortSelect.value;
      connectBtn.innerHTML = `<span>Conectar ${channelName}</span>`;
    }

    if (opDisconnectBtn) opDisconnectBtn.style.display = 'none';
    if (opConnectBtn) {
      opConnectBtn.style.display = 'inline-flex';
      opConnectBtn.disabled = !opSerialPortSelect || !opSerialPortSelect.value;
      opConnectBtn.innerHTML = '<span>Conectar</span>';
    }

    if (weightMetaEl) {
      weightMetaEl.textContent = 'Seleccione el puerto COM y presione Conectar';
    }
  }

  // 3. Sync Dropdown Selection for active channel
  syncPortDropdownForActiveChannel();
}

/**
 * Sync dropdown selection for active channel
 */
function syncPortDropdownForActiveChannel() {
  const selects = [serialPortSelect, opSerialPortSelect].filter(Boolean);
  if (selects.length === 0 || detectedPorts.length === 0) return;

  const ch = channels[activeChannel];
  let targetPort = null;

  if (ch && ch.connected && ch.port && detectedPorts.some((p) => p.path === ch.port)) {
    targetPort = ch.port;
  } else if (ch && ch.savedPort && detectedPorts.some((p) => p.path === ch.savedPort)) {
    targetPort = ch.savedPort;
  } else {
    const usbPorts = detectedPorts.filter((p) => p.isUsb);
    if (activeChannel === 'truck-2' && usbPorts.length > 1) {
      targetPort = usbPorts[1].path;
    } else if (usbPorts.length > 0) {
      targetPort = usbPorts[0].path;
    } else if (detectedPorts.length > 0) {
      targetPort = detectedPorts[0].path;
    }
  }

  if (targetPort) {
    selects.forEach((s) => {
      s.value = targetPort;
    });
  }

  if (ch && !ch.connected) {
    if (connectBtn) connectBtn.disabled = !targetPort;
    if (opConnectBtn) opConnectBtn.disabled = !targetPort;
  }
}

/**
 * Update serial status
 */
function updateSerialStatus(status) {
  const truckId = status.truckId || 'truck-1';
  if (channels[truckId]) {
    channels[truckId].connected = Boolean(status.connected);
    channels[truckId].port = status.port || null;
    if (status.port) {
      channels[truckId].savedPort = status.port;
    }
  }

  if (truckId === activeChannel) {
    renderActiveChannel();
  }
}

/**
 * Update overall app status
 */
function updateAppStatus(status) {
  if (status.channels) {
    for (const [id, ch] of Object.entries(status.channels)) {
      if (channels[id]) {
        channels[id].connected = Boolean(ch.connected);
        channels[id].port = ch.port || null;
        if (ch.savedPort) {
          channels[id].savedPort = ch.savedPort;
        }
      }
    }
  } else if (status.serial && channels['truck-1']) {
    channels['truck-1'].connected = Boolean(status.serial.connected);
    channels['truck-1'].port = status.serial.port || null;
  }

  renderActiveChannel();

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
async function connectToSerial(explicitPort) {
  const selectedPort = explicitPort || opSerialPortSelect?.value || serialPortSelect?.value;
  if (!selectedPort) return;

  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.innerHTML = `<span>Conectando...</span>`;
  }
  if (opConnectBtn) {
    opConnectBtn.disabled = true;
    opConnectBtn.innerHTML = `<span>Conectando...</span>`;
  }

  const channelName = activeChannel === 'truck-1' ? 'Balanza 1' : 'Balanza 2';
  try {
    const result = await ipcRenderer.invoke('connect-serial-port', selectedPort, activeChannel);
    if (result.success) {
      addLogEntry('success', `[${channelName}] Conectado al puerto ${selectedPort}`);
      if (channels[activeChannel]) {
        channels[activeChannel].connected = true;
        channels[activeChannel].port = selectedPort;
        channels[activeChannel].savedPort = selectedPort;
      }
      localStorage.setItem(`sobifruits_saved_port_${activeChannel}`, selectedPort);
      if (activeChannel === 'truck-1') {
        localStorage.setItem('sobifruits_saved_port', selectedPort);
      }
      renderActiveChannel();
    } else {
      addLogEntry('error', `[${channelName}] Fallo de conexión en ${selectedPort}: ${result.error}`);
      renderActiveChannel();
    }
  } catch (err) {
    addLogEntry('error', `Error al conectar: ${err.message}`);
    renderActiveChannel();
  }
}

async function disconnectFromSerial() {
  if (disconnectBtn) {
    disconnectBtn.disabled = true;
    disconnectBtn.innerHTML = `<span>Desconectando...</span>`;
  }
  if (opDisconnectBtn) {
    opDisconnectBtn.disabled = true;
    opDisconnectBtn.innerHTML = `<span>Desconectando...</span>`;
  }

  const channelName = activeChannel === 'truck-1' ? 'Balanza 1' : 'Balanza 2';
  try {
    const result = await ipcRenderer.invoke('disconnect-serial-port', activeChannel);
    if (result.success) {
      addLogEntry('info', `[${channelName}] Balanza desconectada.`);
      if (channels[activeChannel]) {
        channels[activeChannel].connected = false;
        channels[activeChannel].port = null;
      }
      renderActiveChannel();
    } else {
      addLogEntry('error', `[${channelName}] Error al desconectar: ${result.error}`);
      renderActiveChannel();
    }
  } catch (err) {
    addLogEntry('error', `Error: ${err.message}`);
    renderActiveChannel();
  } finally {
    if (disconnectBtn) {
      disconnectBtn.disabled = false;
      disconnectBtn.innerHTML = `<span>Desconectar</span>`;
    }
    if (opDisconnectBtn) {
      opDisconnectBtn.disabled = false;
      opDisconnectBtn.innerHTML = `<span>Desconectar</span>`;
    }
  }
}

async function refreshSerialPorts() {
  if (refreshPortsBtn) refreshPortsBtn.disabled = true;
  if (opRefreshPortsBtn) opRefreshPortsBtn.disabled = true;

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
    if (opRefreshPortsBtn) opRefreshPortsBtn.disabled = false;
  }
}

function populateSerialPorts(ports) {
  const selects = [serialPortSelect, opSerialPortSelect].filter(Boolean);
  if (selects.length === 0) return;

  // Filter out any virtual Bluetooth ports just in case
  const cleanPorts = (ports || []).filter(
    (p) => !/bluetooth|bth|v[íi]nculo bluetooth/i.test(p.friendlyName || p.manufacturer || '')
  );

  cleanPorts.sort((a, b) => {
    if (Boolean(a.isUsb) !== Boolean(b.isUsb)) return a.isUsb ? -1 : 1;
    const numA = parseInt((a.path || '').replace(/\D/g, ''), 10) || 0;
    const numB = parseInt((b.path || '').replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });

  detectedPorts = cleanPorts;

  selects.forEach((select) => {
    select.innerHTML = '<option value="">Seleccione un puerto...</option>';
    cleanPorts.forEach((port) => {
      const option = document.createElement('option');
      option.value = port.path;
      const tag = port.isUsb ? ' ★ USB' : '';
      const label = port.friendlyName || port.manufacturer
        ? `${port.path} (${port.friendlyName || port.manufacturer})${tag}`
        : `${port.path}${tag}`;
      option.textContent = label;
      select.appendChild(option);
    });
  });

  syncPortDropdownForActiveChannel();
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
        <span class="log-time">${e.timestamp}</span>
        <span class="log-tag ${tagClass}">${e.level.toUpperCase()}</span>
        <span class="log-msg">${escapeHtml(e.message)}</span>
      </div>
    `;
    })
    .join('');

  activityLogEl.innerHTML = html;
  activityLogEl.scrollTop = activityLogEl.scrollHeight;
}

function clearLog() {
  logEntries = [];
  if (activityLogEl) {
    activityLogEl.innerHTML = '<div class="empty-log">Historial limpiado.</div>';
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
