const express = require('express');
const cors = require('cors');
const config = require('./config');

class HttpWeightServer {
  constructor(options = {}) {
    this.app = express();
    this.server = null;
    this.port = config.httpServer.port;
    this.host = config.httpServer.host;
    this.serialManager = options.serialManager || null;

    // Store latest weight data for each truck
    this.weightData = {};

    // Initialize supported trucks
    config.weight.supportedTrucks.forEach((truckId) => {
      this.weightData[truckId] = {
        value: 0,
        timestamp: new Date(),
        connected: false,
      };
    });

    if (config.development.enableDebugLogging) {
      console.log(
        'Initialized weight data for trucks:',
        Object.keys(this.weightData)
      );
    }

    this.setupRoutes();
  }

  setSerialManager(serialManager) {
    this.serialManager = serialManager;
  }

  setupRoutes() {
    // Private Network Access & CORS headers for Vercel HTTPS -> Localhost support
    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Tenant-ID');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });

    // Enable CORS for frontend requests
    this.app.use(cors(config.cors));

    this.app.use(express.json());

    // Generic latest weight endpoint (default to truck-1 or first available)
    this.app.get('/api/weight', (req, res) => {
      const data = this.weightData['truck-1'] || Object.values(this.weightData)[0] || { value: 0, timestamp: new Date(), connected: false };
      const isConnected = this.serialManager ? Boolean(this.serialManager.isConnected) : Boolean(data.connected);
      res.json({
        success: true,
        truckId: 'truck-1',
        weight: data.value,
        timestamp: data.timestamp,
        connected: isConnected,
      });
    });

    // Get latest weight for specific truck
    this.app.get('/api/weight/:truckId', (req, res) => {
      const { truckId } = req.params;
      const data = this.weightData[truckId];

      if (data) {
        const isConnected = this.serialManager ? Boolean(this.serialManager.isConnected) : Boolean(data.connected);
        res.json({
          success: true,
          truckId,
          weight: data.value,
          timestamp: data.timestamp,
          connected: isConnected,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Truck not found',
        });
      }
    });

    // Get all trucks' weight data
    this.app.get('/api/weights', (req, res) => {
      const isConnected = this.serialManager ? Boolean(this.serialManager.isConnected) : false;
      const trucksData = {};
      for (const [truckId, data] of Object.entries(this.weightData)) {
        trucksData[truckId] = {
          ...data,
          connected: this.serialManager ? isConnected : Boolean(data.connected),
        };
      }
      res.json({
        success: true,
        trucks: trucksData,
      });
    });

    // List available serial ports
    this.app.get('/api/ports', async (req, res) => {
      try {
        const ports = this.serialManager ? await this.serialManager.listPorts() : [];
        res.json({
          success: true,
          ports,
          currentPort: this.serialManager ? this.serialManager.currentPort : null,
          connected: this.serialManager ? this.serialManager.isConnected : false,
        });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message, ports: [], connected: false });
      }
    });

    // Connect to serial port
    this.app.post('/api/ports/connect', async (req, res) => {
      try {
        const { port } = req.body;
        if (!this.serialManager) {
          return res.status(500).json({ success: false, error: 'Serial manager no inicializado' });
        }
        if (!port) {
          return res.status(400).json({ success: false, error: 'Debe especificar el puerto' });
        }
        const success = await this.serialManager.connect(port);
        res.json({
          success,
          port,
          connected: this.serialManager.isConnected,
        });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Disconnect from serial port
    this.app.post('/api/ports/disconnect', async (req, res) => {
      try {
        if (!this.serialManager) {
          return res.status(500).json({ success: false, error: 'Serial manager no inicializado' });
        }
        const success = await this.serialManager.disconnect();
        res.json({ success, connected: false });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        success: true,
        message: 'Weight capture server is running',
        timestamp: new Date(),
        serialConnected: this.serialManager ? this.serialManager.isConnected : false,
        currentPort: this.serialManager ? this.serialManager.currentPort : null,
      });
    });

    // Manual weight submission (for testing)
    this.app.post('/api/weight/:truckId', (req, res) => {
      const { truckId } = req.params;
      const { weight } = req.body;

      if (this.weightData[truckId] !== undefined) {
        this.updateWeight(truckId, weight);
        res.json({
          success: true,
          message: 'Weight updated',
          truckId,
          weight,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Truck not found',
        });
      }
    });

    // List available printers (auto-detects Zebra / ZDesigner)
    this.app.get('/api/printers', async (req, res) => {
      try {
        const { BrowserWindow } = require('electron');
        const win = BrowserWindow.getAllWindows()[0];
        if (win && win.webContents) {
          const printers = await win.webContents.getPrintersAsync();
          return res.json({
            success: true,
            printers: printers.map((p) => ({
              name: p.name,
              displayName: p.displayName || p.name,
              isDefault: p.isDefault,
              isZebra: /zebra|zdesigner/i.test(p.name || ''),
              status: p.status,
            })),
          });
        }
        res.json({ success: true, printers: [] });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Print label to Zebra or default printer
    this.app.post('/api/print/label', async (req, res) => {
      try {
        const { imageBase64, printerName, registro, datosGenerales } = req.body;
        if (!imageBase64) {
          return res.status(400).json({ success: false, error: 'Se requiere imageBase64' });
        }

        const { BrowserWindow, app } = require('electron');
        const path = require('path');
        const fs = require('fs');

        // Guardar respaldo de la ficha en Documents/SobiFruits_Fichas (igual que software anterior)
        try {
          const documentsPath = app.getPath('documents');
          const outputDir = path.join(documentsPath, 'SobiFruits_Fichas');
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          const cargaStr = datosGenerales?.carga || datosGenerales?.lote || 'SinCarga';
          const fileName = `Ficha_${cargaStr}_${new Date().toISOString().split('T')[0]}_Jaba${registro?.jabas || '0'}.png`;
          const filePath = path.join(outputDir, fileName);
          const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        } catch (saveErr) {
          console.warn('Advertencia al guardar respaldo de imagen de ficha:', saveErr);
        }

        // Buscar impresora Zebra automáticamente si no se especificó
        let targetPrinter = printerName;
        const mainWin = BrowserWindow.getAllWindows()[0];
        if (!targetPrinter && mainWin && mainWin.webContents) {
          try {
            const printers = await mainWin.webContents.getPrintersAsync();
            const zebraPrinter = printers.find((p) => /zebra|zdesigner/i.test(p.name || ''));
            if (zebraPrinter) {
              targetPrinter = zebraPrinter.name;
            }
          } catch (e) {
            console.warn('No se pudo listar impresoras para autodetección:', e);
          }
        }

        // Crear ventana offscreen para imprimir
        const printWin = new BrowserWindow({
          show: false,
          width: 680,
          height: 490,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        const htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              @page { size: 100mm 75mm; margin: 0; }
              body { margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; background: white; }
              img { width: 100%; height: 100%; object-fit: contain; display: block; }
            </style>
          </head>
          <body>
            <img src="${imageBase64}" />
          </body>
          </html>
        `;

        await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

        const printOptions = {
          silent: true,
          printBackground: true,
          margins: { marginType: 'none' },
          pageSize: { width: 100000, height: 75000 },
        };

        if (targetPrinter) {
          printOptions.deviceName = targetPrinter;
        }

        printWin.webContents.print(printOptions, (success, failureReason) => {
          printWin.close();
          if (success) {
            res.json({
              success: true,
              message: targetPrinter
                ? `Etiqueta impresa en ${targetPrinter}`
                : 'Etiqueta enviada a la impresora predeterminada',
              printer: targetPrinter,
            });
          } else {
            res.status(500).json({
              success: false,
              error: `Error al imprimir: ${failureReason}`,
            });
          }
        });
      } catch (err) {
        console.error('Error en /api/print/label:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, this.host, (err) => {
        if (err) {
          console.error('Failed to start HTTP weight server:', err);
          reject(err);
        } else {
          console.log(
            `HTTP Weight Server started on http://${this.host}:${this.port}`
          );
          console.log('Allowed CORS origins:', config.cors.origin);
          resolve();
        }
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('HTTP Weight Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Update weight data for a truck
  updateWeight(truckId, value) {
    if (this.weightData[truckId] !== undefined) {
      const numericValue = parseFloat(value);
      this.weightData[truckId] = {
        value: numericValue,
        timestamp: new Date(),
        connected: this.serialManager ? Boolean(this.serialManager.isConnected) : true,
      };

      if (config.development.enableDebugLogging) {
        console.log(
          `Weight updated for ${truckId}: ${numericValue}kg at ${new Date().toLocaleTimeString()}`
        );
      } else {
        console.log(`Weight updated for ${truckId}: ${numericValue}kg`);
      }
    } else {
      console.warn(`Attempted to update weight for unknown truck: ${truckId}`);
    }
  }

  // Set connection status for a truck
  setConnectionStatus(truckId, connected) {
    if (this.weightData[truckId] !== undefined) {
      this.weightData[truckId].connected = connected;
      console.log(
        `Connection status for ${truckId}: ${
          connected ? 'connected' : 'disconnected'
        }`
      );
    }
  }

  // Get current weight for a truck
  getWeight(truckId) {
    return this.weightData[truckId] || null;
  }
}

module.exports = { HttpWeightServer };
