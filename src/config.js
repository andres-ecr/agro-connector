/**
 * Configuration for Weight Capture Service
 * Handles HTTP server, CORS, weight capture, and development settings
 */

const isDevelopment = process.env.NODE_ENV === 'development';

const config = {
  // HTTP Server Configuration
  httpServer: {
    port: process.env.HTTP_SERVER_PORT || 8080,
    host: process.env.HTTP_SERVER_HOST || 'localhost',
  },

  // CORS Configuration
  cors: {
    origin: isDevelopment 
      ? ['http://localhost:3000', 'http://127.0.0.1:3000'] // Development origins
      : ['http://localhost:3000', 'http://127.0.0.1:3000'], // Production origins
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  },

  // Weight Capture Configuration
  weight: {
    // Supported trucks for weight capture
    supportedTrucks: ['truck-1', 'truck-2'],
    
    // Default weight value when no data is available
    defaultWeight: 0,
    
    // Weight update interval (in milliseconds)
    updateInterval: 1000,
    
    // Serial port configuration
    serial: {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false,
    },
  },

  // Development Configuration
  development: {
    enableDebugLogging: isDevelopment || process.env.DEBUG === 'true',
    enableVerboseLogging: isDevelopment,
    logLevel: isDevelopment ? 'debug' : 'info',
  },

  // Application Configuration
  app: {
    name: 'Weight Capture Service',
    version: '1.0.0',
    description: 'Lightweight Electron app that bridges weight scale data to web applications',
    
    // Window configuration
    window: {
      width: 800,
      height: 600,
      minWidth: 600,
      minHeight: 400,
      resizable: true,
      minimizable: true,
      maximizable: true,
      closable: true,
    },
    
    // Tray configuration
    tray: {
      enabled: true,
      iconPath: 'assets/tray-icon.png',
      tooltip: 'Weight Capture Service',
    },
  },

  // API Configuration
  api: {
    // Base path for all API endpoints
    basePath: '/api',
    
    // Endpoints
    endpoints: {
      weight: '/weight/:truckId',
      weights: '/weights',
      health: '/health',
    },
    
    // Response configuration
    response: {
      timeout: 5000, // 5 seconds
      maxRetries: 3,
      retryDelay: 1000, // 1 second
    },
  },
};

module.exports = config;
