const express = require('express');
const cors = require('cors');
const config = require('./config');

class HttpWeightServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.port = config.httpServer.port;
    this.host = config.httpServer.host;

    // Store latest weight data for each truck
    this.weightData = {};

    // Initialize supported trucks
    config.weight.supportedTrucks.forEach((truckId) => {
      this.weightData[truckId] = {
        value: 0,
        timestamp: new Date(),
        connected: true, // HTTP server is available, so consider it "connected"
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
      res.json({
        success: true,
        truckId: 'truck-1',
        weight: data.value,
        timestamp: data.timestamp,
        connected: data.connected,
      });
    });

    // Get latest weight for specific truck
    this.app.get('/api/weight/:truckId', (req, res) => {
      const { truckId } = req.params;
      const data = this.weightData[truckId];

      if (data) {
        res.json({
          success: true,
          truckId,
          weight: data.value,
          timestamp: data.timestamp,
          connected: data.connected,
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
      res.json({
        success: true,
        trucks: this.weightData,
      });
    });

    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        success: true,
        message: 'Weight capture server is running',
        timestamp: new Date(),
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
        connected: true,
      };

      if (config.development.enableDebugLogging) {
        console.log(
          `Weight updated for ${truckId}: ${numericValue}kg at ${new Date().toLocaleTimeString()}`
        );
        console.log(
          'Current weight data:',
          JSON.stringify(this.weightData, null, 2)
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
