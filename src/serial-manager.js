const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { EventEmitter } = require('events');

class SerialManager extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.parser = null;
    this.availablePorts = [];
    this.isConnected = false;
    this.currentPort = null;
    this.autoReconnect = true;
    this.reconnectInterval = null;
    this.lastWeight = null;
    this.debugMode = false;
    this.connectionSettings = {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false,
    };
  }

  /**
   * List all available serial ports
   */
  async listPorts() {
    try {
      this.availablePorts = await SerialPort.list();
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
      autoReconnect: this.autoReconnect,
      debugMode: this.debugMode,
      lastWeight: this.lastWeight,
      settings: this.connectionSettings,
    };
  }
}

module.exports = SerialManager;

