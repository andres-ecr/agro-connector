const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { EventEmitter } = require('events');

function getConfigFilePath() {
  try {
    const { app } = require('electron');
    if (app && app.getPath) {
      return path.join(app.getPath('userData'), 'serial-config.json');
    }
  } catch (e) {
    // ignore
  }
  return path.join(process.cwd(), 'serial-config.json');
}

class SerialManager extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.parser = null;
    this.availablePorts = [];
    this.isConnected = false;
    this.currentPort = null;
    this.savedPort = null;
    this.autoReconnect = true;
    this.reconnectInterval = null;
    this.autoScanTimer = null;
    this.lastWeight = null;
    this.debugMode = false;
    this.connectionSettings = {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false,
    };

    this.loadConfig();
  }

  /**
   * Load saved serial configuration
   */
  loadConfig() {
    try {
      const cfgPath = getConfigFilePath();
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.lastPort) this.savedPort = parsed.lastPort;
        if (parsed.baudRate) this.connectionSettings.baudRate = parsed.baudRate;
        console.log(`Loaded serial config: lastPort=${this.savedPort}`);
      }
    } catch (e) {
      console.warn('Could not read serial-config.json:', e.message);
    }
  }

  /**
   * Persist current port configuration
   */
  saveConfig() {
    try {
      const cfgPath = getConfigFilePath();
      const data = {
        lastPort: this.savedPort || this.currentPort,
        baudRate: this.connectionSettings.baudRate,
      };
      fs.writeFileSync(cfgPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`Saved serial config: lastPort=${data.lastPort}`);
    } catch (e) {
      console.warn('Could not save serial-config.json:', e.message);
    }
  }

  /**
   * List all available serial ports with USB detection and validity check
   */
  async listPorts() {
    try {
      const rawPorts = await SerialPort.list();
      this.availablePorts = rawPorts.map((p) => {
        const isAcpiErrorPort =
          (p.pnpId && p.pnpId.includes('ACPI\\PNP0501')) ||
          (p.path === 'COM1' && /standard/i.test(p.manufacturer || ''));
        const isUsb = Boolean(
          (p.pnpId && p.pnpId.toUpperCase().includes('USB')) ||
          p.vendorId ||
          /usb|ch34|ftdi|pl2303|cp210|prolific|silicon/i.test(p.friendlyName || p.manufacturer || '')
        );

        return {
          ...p,
          isUsb,
          isAcpiErrorPort,
          isValid: !isAcpiErrorPort,
        };
      });
      return this.availablePorts;
    } catch (error) {
      console.error('Error listing ports:', error);
      this.emit('error', `Error listing ports: ${error.message}`);
      return [];
    }
  }

  /**
   * Connect to specific port
   */
  async connect(portPath) {
    try {
      if (this.isConnected) {
        await this.disconnect();
      }

      console.log(`Attempting to connect to port: ${portPath}`);

      this.port = new SerialPort({
        path: portPath,
        ...this.connectionSettings,
      });

      // Configure parser to read complete lines
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      // Handle port events
      this.port.on('open', () => {
        this.isConnected = true;
        this.currentPort = portPath;
        this.savedPort = portPath;
        this.saveConfig();
        this.emit('connected', portPath);
        console.log(`Connected to port ${portPath}`);
      });

      this.port.on('close', () => {
        this.isConnected = false;
        this.currentPort = null;
        this.emit('disconnected');
        console.log('Disconnected from serial port');

        // Try to reconnect if enabled
        if (this.autoReconnect) {
          this.startReconnectInterval(portPath);
        }
      });

      this.port.on('error', (err) => {
        console.error('Serial port error:', err);
        this.emit('error', `Serial port error: ${err.message}`);
      });

      // Handle received data
      this.parser.on('data', (data) => {
        if (this.debugMode) {
          console.log('Raw data received:', data);
          this.emit('raw-data', data);
        }

        // Try to extract weight from received data
        const weight = this.parseWeight(data);
        if (weight !== null) {
          this.lastWeight = weight;

          // Emit weight with additional metadata
          const weightData = {
            value: weight,
            timestamp: Date.now(),
            port: this.currentPort,
            raw: data,
          };

          this.emit('weight', weightData);
        }
      });

      // Open the port
      await new Promise((resolve, reject) => {
        this.port.open((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      return true;
    } catch (error) {
      console.error('Error connecting:', error);
      this.emit('error', `Error connecting: ${error.message}`);
      return false;
    }
  }

  /**
   * Automatically detect and connect to available scale port
   */
  async autoConnect() {
    if (this.isConnected) return true;

    try {
      const ports = await this.listPorts();
      if (!ports || ports.length === 0) return false;

      // 1. Try saved port if it's currently present and valid
      if (this.savedPort) {
        const matching = ports.find((p) => p.path === this.savedPort);
        if (matching && matching.isValid) {
          console.log(`Auto-connecting to saved port: ${this.savedPort}`);
          const ok = await this.connect(this.savedPort);
          if (ok) return true;
        }
      }

      // 2. Try any valid USB-Serial ports
      const usbPorts = ports.filter((p) => p.isUsb && p.isValid);
      for (const p of usbPorts) {
        console.log(`Auto-connecting to detected USB port: ${p.path}`);
        const ok = await this.connect(p.path);
        if (ok) return true;
      }

      // 3. Try any other valid non-ACPI ports
      const otherValid = ports.filter((p) => p.isValid && !p.isUsb);
      for (const p of otherValid) {
        console.log(`Auto-connecting to candidate port: ${p.path}`);
        const ok = await this.connect(p.path);
        if (ok) return true;
      }

      return false;
    } catch (err) {
      console.error('Error during auto-connect:', err);
      return false;
    }
  }

  /**
   * Start background scan timer for auto-connection on plug-in
   */
  startAutoScan(intervalMs = 4000) {
    if (this.autoScanTimer) clearInterval(this.autoScanTimer);
    this.autoScanTimer = setInterval(async () => {
      if (!this.isConnected && this.autoReconnect) {
        await this.autoConnect();
      }
    }, intervalMs);
  }

  /**
   * Stop background scan timer
   */
  stopAutoScan() {
    if (this.autoScanTimer) {
      clearInterval(this.autoScanTimer);
      this.autoScanTimer = null;
    }
  }

  /**
   * Disconnect from port
   */
  async disconnect() {
    try {
      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval);
        this.reconnectInterval = null;
      }

      if (this.port && this.port.isOpen) {
        await new Promise((resolve) => {
          this.port.close(() => {
            this.isConnected = false;
            this.currentPort = null;
            this.emit('disconnected');
            resolve();
          });
        });
      }

      this.port = null;
      this.parser = null;
      return true;
    } catch (error) {
      console.error('Error disconnecting:', error);
      this.emit('error', `Error disconnecting: ${error.message}`);
      return false;
    }
  }

  /**
   * Start reconnection interval
   */
  startReconnectInterval(portPath) {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }

    this.reconnectInterval = setInterval(async () => {
      console.log('Attempting to reconnect...');
      this.emit('reconnecting');

      try {
        const ports = await this.listPorts();
        const portExists = ports.some((p) => p.path === portPath);

        if (portExists) {
          await this.connect(portPath);
          if (this.isConnected) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
          }
        }
      } catch (error) {
        console.error('Error reconnecting:', error);
      }
    }, 5000); // Try every 5 seconds
  }

  /**
   * Change connection settings
   */
  setConnectionSettings(settings) {
    this.connectionSettings = {
      ...this.connectionSettings,
      ...settings,
    };

    this.emit('settings-changed', this.connectionSettings);
    return this.connectionSettings;
  }

  /**
   * Enable/disable debug mode
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
    this.emit('debug-mode', enabled);
    return this.debugMode;
  }

  /**
   * Enable/disable auto-reconnect
   */
  setAutoReconnect(enabled) {
    this.autoReconnect = enabled;
    this.emit('auto-reconnect', enabled);

    if (!enabled && this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    return this.autoReconnect;
  }

  /**
   * Parse different data formats to extract weight
   */
  parseWeight(data) {
    if (!data) return null;

    // Remove whitespace and non-printable characters
    const cleanData = data
      .toString()
      .trim()
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '');

    try {
      // Method 1: Look for number with up to 2 decimals (common in scales)
      const weightRegex = /(\d+\.?\d{0,2})/;
      const match = cleanData.match(weightRegex);

      if (match && match[1]) {
        const weight = parseFloat(match[1]);
        if (!isNaN(weight)) {
          return weight;
        }
      }

      // Method 2: Some devices send "WT: X.XX" or similar
      const labeledWeightRegex = /(?:WT|WEIGHT|W|PESO|NET)\s*:?\s*(\d+\.?\d*)/i;
      const labeledMatch = cleanData.match(labeledWeightRegex);

      if (labeledMatch && labeledMatch[1]) {
        const weight = parseFloat(labeledMatch[1]);
        if (!isNaN(weight)) {
          return weight;
        }
      }

      // Method 3: Some devices send data in specific format
      // For example: "ST,GS,+   1.234 kg"
      const complexFormatRegex =
        /[A-Z]{2},?[A-Z]{2},?[+-]?\s*(\d+\.?\d*)\s*(?:kg|g|lb)?/i;
      const complexMatch = cleanData.match(complexFormatRegex);

      if (complexMatch && complexMatch[1]) {
        const weight = parseFloat(complexMatch[1]);
        if (!isNaN(weight)) {
          return weight;
        }
      }

      // Last resort: extract any sequence of digits with possible decimal point
      const lastResortRegex = /(-?\d+\.?\d*)/;
      const lastMatch = cleanData.match(lastResortRegex);

      if (lastMatch && lastMatch[1]) {
        const weight = parseFloat(lastMatch[1]);
        if (!isNaN(weight)) {
          return weight;
        }
      }

      return null;
    } catch (error) {
      console.error('Error parsing weight data:', error);
      return null;
    }
  }

  /**
   * Send command to scale (some scales accept commands)
   */
  async sendCommand(command) {
    if (!this.isConnected || !this.port) {
      throw new Error('No connection to serial port');
    }

    return new Promise((resolve, reject) => {
      this.port.write(command, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Request weight (some scales require command to send weight)
   */
  async requestWeight() {
    try {
      // Common commands to request weight from different scales
      const commands = [
        'P\r\n', // Common command for some scales
        'W\r\n', // Another common command
        'R\r\n', // Read command
        'S\r\n', // Stabilization command
        '\r\n', // Sometimes just carriage return works
      ];

      // Try each command with small delay between them
      for (const cmd of commands) {
        await this.sendCommand(cmd);

        // Wait a bit to give scale time to respond
        await new Promise((resolve) => setTimeout(resolve, 500));

        // If we received weight, stop the cycle
        if (this.lastWeight !== null) {
          return this.lastWeight;
        }
      }

      return null;
    } catch (error) {
      console.error('Error requesting weight:', error);
      this.emit('error', `Error requesting weight: ${error.message}`);
      return null;
    }
  }

  /**
   * Get current connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      port: this.currentPort,
      savedPort: this.savedPort,
      autoReconnect: this.autoReconnect,
      debugMode: this.debugMode,
      lastWeight: this.lastWeight,
      settings: this.connectionSettings,
    };
  }
}

module.exports = SerialManager;

