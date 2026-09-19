# Agro ERP - Hardware Scale Connector

High-performance, lightweight Electron and Node.js hardware bridge service that interfaces industrial RS-232 serial weighing indicators and bridges real-time scale readings to the **Agro ERP** web application.

---

## 🏛️ Architecture Overview

The scale connector operates locally on plant weighing station PCs as a native background service (minimized to the Windows System Tray). It establishes direct serial communication over RS-232 / USB COM ports with weighing indicator terminals and exposes a low-latency local REST HTTP API on port `8080`.

```
┌─────────────────────────┐          RS-232 / USB Serial          ┌───────────────────────────────────┐
│ Industrial Scale /      │ ────────────────────────────────────> │ Scale Connector (Electron / Node) │
│ Weighbridge Terminal    │       (9600-115200 baud, 8N1)         │ Local Service (Port 8080)         │
└─────────────────────────┘                                       └─────────────────┬─────────────────┘
                                                                                    │ Local REST API
                                                                                    │ (CORS enabled)
                                                                                    ▼
                                                                  ┌───────────────────────────────────┐
                                                                  │ Agro ERP Web Application          │
                                                                  │ (Next.js Frontend @ :3000)        │
                                                                  └───────────────────────────────────┘
```

- **Runtime**: Electron 35 & Node.js
- **Serial Protocol**: `@serialport/node` with configurable delimiter parser (`\r\n`, STX/ETX, continuous stream)
- **Local HTTP Server**: Express-powered REST server running on `http://127.0.0.1:8080` with preconfigured CORS headers allowing requests from `http://localhost:3000`.
- **Licensing**: Standalone, royalty-free open connector designed for direct plant integration without remote licensing validation overhead.

---

## 📡 REST HTTP API Reference

The connector exposes local endpoints on `http://127.0.0.1:8080`:

### 1. Health Check
```http
GET /api/health
```
**Response (200 OK):**
```json
{
  "success": true,
  "message": "Weight capture server is running",
  "timestamp": "2026-09-19T15:30:00.000Z"
}
```

### 2. Live Weight Capture
```http
GET /api/weight/:truckId
```
Returns live gross weight, unit, stability indicator, and timestamp.
```json
{
  "success": true,
  "truckId": "truck-1",
  "weight": 14250.0,
  "timestamp": "2026-09-19T15:30:01.250Z",
  "connected": true
}
```

### 3. List Available COM Ports
```http
GET /api/ports
```
Returns an array of detected serial communication ports (e.g. `COM1`, `COM3`, `/dev/ttyUSB0`) with hardware vendor and device metadata.

### 4. Zero Scale Command
```http
POST /api/zero
```
Sends the zero calibration command string to the connected RS-232 scale terminal.

### 5. Tare Scale Command
```http
POST /api/tare
```
Triggers a tare capture or transmits a tare command packet to the indicator.

---

## ⚙️ Serial Port Configuration

Communication settings can be configured via the graphical UI or through local configuration:

| Setting | Default Value | Supported Options |
|---|---|---|
| **Baud Rate** | `9600` | `2400`, `4800`, `9600`, `19200`, `38400`, `57600`, `115200` |
| **Data Bits** | `8` | `7`, `8` |
| **Stop Bits** | `1` | `1`, `2` |
| **Parity** | `none` | `none`, `even`, `odd` |
| **Flow Control** | `None` | `RTS/CTS`, `XON/XOFF` |
| **HTTP Port** | `8080` | Configurable via `HTTP_SERVER_PORT` |

---

## 🚀 Setup & Execution

### Prerequisites
- **Node.js**: `v18.x` or `v20.x` LTS
- **C++ Build Tools**: Visual Studio Build Tools (Windows) or `build-essential` (Linux) for native `@serialport` compilation.

### 1. Install Dependencies
```bash
npm install
```

### 2. Rebuild Native Serial Modules
Compile the native serialport bindings for the Electron runtime:
```bash
npm run rebuild
```
*(Executes `@electron/rebuild -f -w serialport`)*

### 3. Run Application
Start the background connector in development mode:
```bash
npm start
```
*Or for debug mode with DevTools:*
```bash
npm run dev
```

### 4. Build Windows Installer / Executable
Package into a standalone Windows installer (`.exe`) with embedded runtime and system tray integration:
```bash
npm run package-win
```

---

## 🛡️ License & Confidentiality

Proprietary software. All rights reserved.
