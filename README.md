# Guardian SOS — Women's Safety System

A personal-safety system connecting a wearable hardware band (**ESP8266 + NEO-6M GPS + SIM800L GSM**), a mobile-first **Victim Web App (PWA)** with a 3-second hold SOS trigger, an **Emergency Dispatch Admin Console** with real-time Leaflet telemetry and alarm sirens, and an Express + Socket.IO **central server** deployed on **Render**.

---

## 1. System Architecture

```
                 +-------------------------------------------------+
                 |   Hardware Band (ESP8266 + GPS + SIM800L)       |
                 |   • POST /api/location (x-api-key)              |
                 |   • GET /api/device/:deviceId/command (every 5s)|
                 +------------------------+------------------------+
                                          |
                                          | HTTPS / REST
                                          v
+------------------------+      +------------------+      +-------------------------+
|   Victim Web App (PWA) |      |                  |      | Emergency Admin Console |
| • 3s Hold SOS Ring     |<---->|  Express Server  |<---->| • Live Leaflet GPS Map  |
| • watchPosition GPS    | REST |  + Socket.IO     | REST | • Audio Siren Alarm     |
| • Screen Wake Lock     | + WS |  Node 20 / TS    | + WS | • Instant Call / WA /   |
| • SMS Fallback Link    |      |                  |      |   SMS Contact Dialers   |
+------------------------+      +--------+---------+      +-------------------------+
                                         |
                                         v
                         +--------------------------------+
                         |       PostgreSQL Database      |
                         |  (Production: Render Postgres  |
                         |   Local Dev: pg-mem fallback)  |
                         +--------------------------------+
```

---

## 2. Firmware Configuration (ESP8266 `.ino`)

Open [`safety_band_nodemcu_esp8266/safety_band_nodemcu_esp8266.ino`](safety_band_nodemcu_esp8266/safety_band_nodemcu_esp8266.ino). In the **CONFIG** section (lines 40–44), set the following lines:

```cpp
// 1. Phone hotspot / WiFi credentials
const char* WIFI_SSID   = "YOUR_WIFI_HOTSPOT_NAME";
const char* WIFI_PASS   = "YOUR_WIFI_PASSWORD";

// 2. Exact Server Endpoints (replace <app-name> with your Render service URL)
const char* SERVER_URL  = "https://<app-name>.onrender.com/api/location";
const char* COMMAND_URL = "https://<app-name>.onrender.com/api/device/band-001/command";

// 3. API Key (must match DEVICE_API_KEY environment variable on server)
const char* API_KEY     = "your_device_api_key_here";
```

### Band Hardware Contract:
- **`POST /api/location`**: Band sends `sos_start`, `sos_update` (breadcrumbs), or `sos_cancel`. Returns `200 {"ok":true}` in under 3 seconds.
- **`GET /api/device/:deviceId/command`**: Band polls every 5 seconds. The server atomically returns and consumes **exactly one** of:
  - `{"command":"sos"}`
  - `{"command":"stop"}`
  - `{"command":"none"}`

> **Important**: The firmware searches for `"sos"` and `"stop"` as substrings. The server outputs strict JSON without any extra whitespace or overlapping keywords.

---

## 3. Local Development (Zero-Setup)

The server automatically falls back to an in-memory PostgreSQL engine (`pg-mem`) when `DATABASE_URL` is unset, so you can run the entire system with zero external database configuration:

### Prerequisites
- Node.js 20+
- npm 10+

### Steps
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create local `.env`:
   ```bash
   cp .env.example .env
   ```
3. Run both web and server in development mode:
   ```bash
   npm run build
   npm start
   ```
4. Access the web applications:
   - **Victim PWA**: `http://localhost:3000/`
   - **Emergency Admin Console**: `http://localhost:3000/admin`
   - **Health Check**: `http://localhost:3000/healthz`
   - **Default Admin Login**: `admin@safety.local` / `AdminSecurePassword123!`

---

## 4. Automated Testing & Band Simulation

### Run Automated Tests (Vitest + Supertest)
```bash
npm test
```
Verifies:
- Hardware authentication via timing-safe `crypto.timingSafeEqual`.
- Atomic one-time command consumption queue.
- `sos_start` opening incidents and real-time Socket.IO dispatch.
- Strict 5-contact limit per user.
- Role-based authorization on admin routes.
- Automatic privacy data retention cleanup.

### Hardware Band Simulation
Simulate band telemetry without physical hardware:
- **Bash / Linux / Mac**:
  ```bash
  ./scripts/simulate-band.sh http://localhost:3000 dev_device_api_key_12345 band-001
  ```
- **Windows PowerShell**:
  ```powershell
  .\scripts\simulate-band.ps1 -BaseUrl "http://localhost:3000" -ApiKey "dev_device_api_key_12345" -DeviceId "band-001"
  ```

---

## 5. Deployment to Render

The system is configured as an Infrastructure-as-Code Render Blueprint in [`render.yaml`](render.yaml).

### > [!WARNING] Production Reliability Notice: Free Tier vs Always-On
> **Render's Free Tier is suitable for demonstrations and testing only.**
> Free web services spin down after 15 minutes of inactivity, causing cold starts that can delay an initial SOS alert by 50 seconds or more.
> **For any real personal safety or life-critical deployment, an always-on paid plan (e.g., Render Starter/Standard) with a dedicated managed database is strictly recommended.**

### Blueprint Deployment Steps:
1. Push your repository to your GitHub account:
   ```bash
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```
2. Validate Blueprint locally:
   ```bash
   render blueprints validate
   ```
3. Click to deploy via Render's Web Dashboard:
   `https://dashboard.render.com/blueprint/new?repo=https://github.com/<your-username>/<your-repo-name>`
4. Set the required secrets in Render dashboard:
   - `ADMIN_EMAIL`: Email for your primary admin console login.
   - `ADMIN_PASSWORD`: Strong password for the admin console.
5. Click **Apply**. Render will automatically provision the PostgreSQL database, run migrations on boot, build the frontend bundle, and launch the web service.

---

## 6. Security and Privacy Principles

- **Zero Continuous Tracking**: Geolocation coordinates are captured **only during active SOS incidents**. Location tracking ceases immediately upon incident resolution.
- **Configurable Retention Job**: A background worker runs every 24 hours to permanently delete incidents, locations, and dispatch messages older than `RETENTION_DAYS` (default 30 days).
- **Cryptographic Security**:
  - Hardware device API keys verified with `crypto.timingSafeEqual` over SHA-256 digests.
  - User passwords hashed with bcrypt (salt rounds: 10).
  - JWT tokens signed with 7-day expiration and validated on REST and Socket.IO handshakes.
  - Rate limiting on authentication routes and hardware polling endpoints.
  - Helmet CSP configured for OpenStreetMap Leaflet tiles and WebSockets.

---

## 7. Current Implementation & Next-Phase Roadmap

### Current Implementation:
- Full PWA with Service Worker, manifest, 3s hold progress ring, Screen Wake Lock, and offline fallback.
- Admin dispatch center with synthesized Web Audio siren, Web Notifications, Leaflet telemetry with breadcrumbs, and instant contact dialers (`tel:`, `sms:`, and `WhatsApp`).
- Bi-directional Socket.IO communication between victims and dispatch.
- ESP8266 + GPS band hardware contract (`POST /api/location`, `GET /api/device/:deviceId/command`).

### Next-Phase Roadmap:
1. **Capacitor / Flutter Native Wrapper**: Mobile browsers throttle background geolocation when the screen is locked. A Capacitor shell will provide background geolocation services.
2. **Paid SMS Gateway Integration**: Wire Twilio or MSG91 to `SmsProvider` interface for direct carrier SMS dispatch.
3. **Emergency Conference Audio Bridge**: Wire Twilio or Exotel to `CallProvider` interface to bridge victim, contacts, and admin into a single call.
4. **Per-Device Cryptographic Keys**: Rotate individual device keys with ECDSA signatures.
5. **Incident Audio Stream**: Upload short 10-second encrypted audio clips during SOS activation.
