/*
 * Female Safety Band — NodeMCU V3 (ESP8266) + NEO-6M GPS + SIM800L GSM
 * (No physical button, no buzzer — SOS is triggered via Mobile App, SMS, or Serial)
 *
 * Exact Wiring:
 *   GPS (GY-GPS6MV2 / NEO-6M):
 *     VCC -> NodeMCU 3V3
 *     TXD -> NodeMCU D6 (GPIO12)
 *     GND -> Common Ground
 *
 *   SIM800L GSM Module:
 *     VCC -> External Li-ion cell (3.7V - 4.2V) with 1000uF capacitor across VCC/GND
 *     GND -> Common Ground (joined with NodeMCU GND & Li-ion negative)
 *     TXD -> NodeMCU D5 (GPIO14)
 *     RXD -> 1k resistor -> NodeMCU D7 (GPIO13)
 *     Antenna connected
 *
 *   NodeMCU V3:
 *     Powered via USB
 *
 * Board in Arduino IDE: "NodeMCU 1.0 (ESP-12E Module)"
 * Required Library: TinyGPSPlus
 */

#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>

// ================= CONFIGURATION =================
const char* OWNER_NUMBER = "+919599891970";       // Her phone number
const char* CONTACTS[]   = {"+917248549516"};    // Emergency contact (gets SMS + Call)
const int   NUM_CONTACTS = 1;

const char* DEVICE_ID    = "band-001";

// WiFi (phone hotspot or home router)
const char* WIFI_SSID    = "Redmi Note 12 Pro+ 5G";
const char* WIFI_PASS    = "Whatyoudo";

// Cloud Backend Endpoints (Render)
const char* SERVER_URL   = "https://safety-system-yfxl.onrender.com/api/location";
const char* COMMAND_URL  = "https://safety-system-yfxl.onrender.com/api/device/band-001/command";
const char* API_KEY      = "dev_device_api_key_12345";

// ================= PIN ASSIGNMENTS =================
#define PIN_LED    D4   // Onboard NodeMCU LED (active LOW)
#define PIN_GPS_RX D6   // GPS TXD -> D6
#define PIN_GSM_RX D5   // SIM800L TXD -> D5
#define PIN_GSM_TX D7   // NodeMCU D7 -> 1k resistor -> SIM800L RXD

// ================= TIMING =================
const uint32_t SMS_REPEAT_MS  = 60000;            // Repeat SMS every 60s during active SOS
const uint32_t POST_UPDATE_MS = 10000;            // Cloud POST every 10s during active SOS
const uint32_t POLL_MS        = 5000;             // Poll cloud command queue every 5s
const uint32_t SOS_MAX_MS     = 30UL * 60UL * 1000UL; // Auto-timeout SOS after 30 mins

// ================= OBJECTS & GLOBALS =================
TinyGPSPlus gps;
SoftwareSerial gpsSerial(PIN_GPS_RX, -1);         // GPS: receive only on D6
SoftwareSerial gsmSerial(PIN_GSM_RX, PIN_GSM_TX); // SIM800L: RX=D5, TX=D7
WiFiClientSecure secureClient;

bool     sosActive    = false;
uint32_t sosStart     = 0;
uint32_t lastSmsTime  = 0;
uint32_t lastPostTime = 0;
uint32_t lastPollTime = 0;

double   lastLat = 28.622666;                     // Default fallback (Delhi)
double   lastLng = 77.296663;
bool     haveFix = false;

String gsmBuffer, smsSender;
bool   expectSmsBody = false;
String serialBuffer;

// ---------- GPS FUNCTIONS ----------
void feedGPS() {
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }
  if (gps.location.isValid()) {
    lastLat = gps.location.lat();
    lastLng = gps.location.lng();
    haveFix = true;
  }
}

void waitWithGps(uint32_t ms) {
  uint32_t start = millis();
  while (millis() - start < ms) {
    feedGPS();
    delay(5);
  }
}

String getLocationUrl() {
  String url = "https://maps.google.com/?q=" + String(lastLat, 6) + "," + String(lastLng, 6);
  if (!haveFix) {
    url += " (GPS acquiring...)";
  }
  return url;
}

// ---------- ONBOARD LED STATUS ----------
void updateLedStatus() {
  if (sosActive) {
    // SOS active: Fast flashing LED (150ms)
    digitalWrite(PIN_LED, (millis() / 150) % 2 ? LOW : HIGH);
  } else if (gps.location.isValid()) {
    // GPS Fix acquired: Solid ON (active LOW)
    digitalWrite(PIN_LED, LOW);
  } else {
    // Searching for GPS: Slow pulse (600ms)
    digitalWrite(PIN_LED, (millis() / 600) % 2 ? LOW : HIGH);
  }
}

// ---------- SIM800L GSM FUNCTIONS ----------
bool gsmWait(const char* expect, uint32_t timeoutMs) {
  String buf;
  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    while (gsmSerial.available()) {
      char c = gsmSerial.read();
      buf += c;
      Serial.write(c);
      if (buf.indexOf(expect) >= 0) return true;
    }
    feedGPS();
    delay(5);
  }
  return false;
}

bool gsmCommand(const String& cmd, const char* expect = "OK", uint32_t timeoutMs = 3000) {
  while (gsmSerial.available()) gsmSerial.read(); // flush
  Serial.print("\n[GSM CMD] ");
  Serial.println(cmd);
  gsmSerial.print(cmd);
  gsmSerial.print("\r\n");
  return gsmWait(expect, timeoutMs);
}

bool gsmInit() {
  Serial.println("\n[GSM] Initializing SIM800L module...");
  waitWithGps(2000);

  // Sync baud rate
  bool synced = false;
  for (int i = 0; i < 5; i++) {
    gsmSerial.print("AT\r\n");
    if (gsmWait("OK", 1000)) { synced = true; break; }
    delay(200);
  }

  if (!synced) {
    Serial.println("[GSM ERROR] SIM800L not responding. Check Li-ion battery (3.7-4.2V), 1000uF cap, and D5/D7 wiring.");
    return false;
  }

  gsmCommand("ATE0");                   // Echo off
  gsmCommand("AT+CMGF=1");              // Set SMS to text mode
  gsmCommand("AT+CSCS=\"GSM\"");        // GSM standard character set
  gsmCommand("AT+CNMI=2,2,0,0,0");      // Direct SMS delivery to serial
  gsmCommand("AT+CPIN?");               // Check SIM card status
  gsmCommand("AT+CSQ");                 // Check signal strength

  Serial.println("[GSM] Waiting for cellular network registration...");
  for (int i = 0; i < 20; i++) {
    while (gsmSerial.available()) gsmSerial.read();
    gsmSerial.print("AT+CREG?\r\n");
    String reg;
    uint32_t t = millis();
    while (millis() - t < 1000) {
      while (gsmSerial.available()) reg += (char)gsmSerial.read();
      delay(5);
    }
    if (reg.indexOf(",1") >= 0 || reg.indexOf(",5") >= 0) {
      Serial.println("[GSM] SUCCESS: Registered on cellular network!");
      return true;
    }
    feedGPS();
    delay(500);
  }

  Serial.println("[GSM WARNING] Network registration not confirmed yet. Will still attempt SMS.");
  return true;
}

// Send SMS directly via SIM800L
bool sendSmsSim800L(const String& phoneNumber, const String& text) {
  Serial.println("\n==========================================");
  Serial.printf("[SIM800L] SENDING EMERGENCY SMS TO: %s\n", phoneNumber.c_str());
  Serial.println("==========================================");

  // 1. Force Text Mode
  gsmSerial.print("AT+CMGF=1\r\n");
  waitWithGps(200);

  // 2. Clear buffer
  while (gsmSerial.available()) gsmSerial.read();

  // 3. Send CMGS command
  gsmSerial.print("AT+CMGS=\"");
  gsmSerial.print(phoneNumber);
  gsmSerial.print("\"\r\n");

  // 4. Wait for '>' prompt from SIM800L
  uint32_t start = millis();
  bool gotPrompt = false;
  while (millis() - start < 5000) {
    feedGPS();
    if (gsmSerial.available()) {
      char c = gsmSerial.read();
      Serial.write(c);
      if (c == '>') {
        gotPrompt = true;
        break;
      }
    }
    delay(5);
  }

  if (!gotPrompt) {
    Serial.println("\n[SIM800L ERROR] No '>' prompt received! Aborting SMS.");
    gsmSerial.write(27); // Send ESC to abort
    return false;
  }

  // 5. Send message content
  waitWithGps(100);
  gsmSerial.print(text);
  waitWithGps(200);

  // 6. Send Ctrl+Z (ASCII 26) to commit and send
  gsmSerial.write(26);

  // 7. Wait for SIM800L to transmit to cell tower
  start = millis();
  String resp = "";
  bool confirmed = false;
  while (millis() - start < 20000) {
    feedGPS();
    if (gsmSerial.available()) {
      char c = gsmSerial.read();
      resp += c;
      Serial.write(c);
      if (resp.indexOf("OK") >= 0 || resp.indexOf("+CMGS:") >= 0) {
        confirmed = true;
        break;
      }
      if (resp.indexOf("ERROR") >= 0) {
        confirmed = false;
        break;
      }
    }
    delay(5);
  }

  if (confirmed) {
    Serial.println("\n[SIM800L] *** EMERGENCY SMS SUCCESSFULLY SENT! ***\n");
  } else {
    Serial.println("\n[SIM800L ERROR] SMS failed or tower timeout: " + resp);
  }
  return confirmed;
}

// Make emergency voice call via SIM800L
void makeCallSim800L(const String& phoneNumber) {
  Serial.printf("\n[SIM800L] Calling emergency contact: %s\n", phoneNumber.c_str());
  gsmCommand("ATD" + phoneNumber + ";", "OK", 5000);
  waitWithGps(20000); // Ring for 20 seconds
  gsmCommand("ATH", "OK", 2000); // Hang up
}

// Send emergency SMS to all configured contacts
void sendEmergencySmsToAll(const String& customPrefix) {
  String message = customPrefix + "\n" +
                   "Sneha needs urgent help!\n" +
                   "Live GPS: " + getLocationUrl();

  for (int i = 0; i < NUM_CONTACTS; i++) {
    sendSmsSim800L(CONTACTS[i], message);
  }
  lastSmsTime = millis();
}

// ---------- CLOUD SERVER (RENDER) ----------
void postLocationToCloud(const char* eventType) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[CLOUD] WiFi not connected. Skipping server POST.");
    return;
  }

  HTTPClient http;
  if (!http.begin(secureClient, SERVER_URL)) return;

  http.setTimeout(4000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);

  String json = String("{\"deviceId\":\"") + DEVICE_ID +
                "\",\"event\":\"" + eventType +
                "\",\"lat\":" + String(lastLat, 6) +
                ",\"lng\":" + String(lastLng, 6) +
                ",\"fix\":" + (haveFix ? "true" : "false") + "}";

  int code = http.POST(json);
  Serial.printf("[CLOUD] POST /api/location (%s) -> HTTP %d\n", eventType, code);
  http.end();
  lastPostTime = millis();
}

void pollServerCommand() {
  lastPollTime = millis();
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  if (!http.begin(secureClient, COMMAND_URL)) return;

  http.setTimeout(3000);
  http.addHeader("x-api-key", API_KEY);
  int code = http.GET();
  String payload = (code == 200) ? http.getString() : "";
  http.end();

  if (code == 200 && payload.indexOf("\"none\"") < 0) {
    Serial.printf("[CLOUD] Received remote command from App: %s\n", payload.c_str());
    if (payload.indexOf("\"sos\"") >= 0) {
      triggerSOS("MOBILE APP (SOS BUTTON)");
    } else if (payload.indexOf("\"stop\"") >= 0) {
      stopSOS("MOBILE APP (RESOLVED)");
    }
  }
}

// ---------- SOS STATE MACHINE ----------
void triggerSOS(const char* source) {
  if (sosActive) return;

  Serial.println("\n******************************************");
  Serial.printf("!!! SOS TRIGGERED VIA: %s !!!\n", source);
  Serial.println("******************************************");

  sosActive = true;
  sosStart  = millis();

  // 1. PRIMARY: Dispatch Emergency SMS via SIM800L module
  sendEmergencySmsToAll("EMERGENCY SOS ALERT!");

  // 2. Make Emergency Call via SIM800L module
  makeCallSim800L(CONTACTS[0]);

  // 3. Update Cloud Dispatch Center on Render
  postLocationToCloud("sos_start");
}

void stopSOS(const char* source) {
  if (!sosActive) return;

  Serial.printf("\n[SOS] SOS Cancelled via: %s\n", source);
  sosActive = false;

  // Send cancellation SMS via SIM800L
  for (int i = 0; i < NUM_CONTACTS; i++) {
    sendSmsSim800L(CONTACTS[i], "SOS CANCELLED. Sneha is now safe.");
  }

  // Update cloud
  postLocationToCloud("sos_cancel");
}

// ---------- INCOMING SMS COMMANDS ----------
String getCleanNumber(const String& num) {
  String digits = "";
  for (unsigned int i = 0; i < num.length(); i++) {
    if (isdigit(num[i])) digits += num[i];
  }
  return digits.length() >= 10 ? digits.substring(digits.length() - 10) : digits;
}

bool isAuthorizedNumber(const String& num) {
  String clean = getCleanNumber(num);
  if (clean.length() < 10) return false;
  if (clean == getCleanNumber(OWNER_NUMBER)) return true;
  for (int i = 0; i < NUM_CONTACTS; i++) {
    if (clean == getCleanNumber(CONTACTS[i])) return true;
  }
  return false;
}

void handleIncomingSms(const String& line) {
  String l = line;
  l.trim();
  if (l.length() == 0) return;

  if (l.startsWith("+CMT:")) {
    int firstQuote = l.indexOf('"');
    int secondQuote = l.indexOf('"', firstQuote + 1);
    smsSender = (firstQuote >= 0 && secondQuote > firstQuote) ? l.substring(firstQuote + 1, secondQuote) : "";
    expectSmsBody = true;
    return;
  }

  if (expectSmsBody) {
    expectSmsBody = false;
    l.toUpperCase();
    Serial.println("\n[GSM] Received SMS from " + smsSender + ": " + l);

    if (isAuthorizedNumber(smsSender)) {
      if (l == "SOS") {
        triggerSOS("INCOMING SMS");
      } else if (l == "STOP") {
        stopSOS("INCOMING SMS");
      } else if (l == "LOC") {
        sendSmsSim800L(smsSender, "Guardian Band Location: " + getLocationUrl());
      }
    } else {
      Serial.println("[GSM] Ignored SMS from unauthorized sender.");
    }
  }
}

void readGsmStream() {
  while (gsmSerial.available()) {
    char c = gsmSerial.read();
    if (c == '\n') {
      String line = gsmBuffer;
      gsmBuffer = "";
      handleIncomingSms(line);
    } else if (c != '\r' && gsmBuffer.length() < 200) {
      gsmBuffer += c;
    }
  }
}

// Read test commands from USB Serial Monitor (115200 baud)
void readSerialMonitorCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      String cmd = serialBuffer;
      serialBuffer = "";
      cmd.trim();
      cmd.toUpperCase();
      if (cmd == "SOS") {
        triggerSOS("SERIAL MONITOR");
      } else if (cmd == "STOP") {
        stopSOS("SERIAL MONITOR");
      } else if (cmd == "LOC") {
        Serial.println("Location: " + getLocationUrl());
      } else if (cmd == "TEST") {
        Serial.println("[TEST] Sending test SMS to " + String(CONTACTS[0]));
        sendSmsSim800L(CONTACTS[0], "Test message from Guardian Band SIM800L!");
      }
    } else if (c != '\r') {
      serialBuffer += c;
    }
  }
}

// ================= SETUP & LOOP =================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n==========================================");
  Serial.println("   GUARDIAN SOS — FEMALE SAFETY BAND      ");
  Serial.println("   (ESP8266 + NEO-6M GPS + SIM800L GSM)   ");
  Serial.println("==========================================");

  // Pin Mode for Status LED
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH); // Turn off initially

  // Secure client for Render HTTPS
  secureClient.setInsecure();

  // UART Software Serials
  gpsSerial.begin(9600);       // D6
  gsmSerial.begin(9600);       // D5 / D7

  // Connect to WiFi Hotspot in background
  if (strlen(WIFI_SSID) > 0) {
    Serial.printf("[WIFI] Connecting to '%s'...\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }

  // Initialize SIM800L module
  gsmInit();

  Serial.println("\n[SYSTEM READY]");
  Serial.println("• SOS is triggered directly from your phone app (or text 'SOS' to this SIM)");
  Serial.println("• Type 'sos' in Serial Monitor to test emergency SMS & call.");
  Serial.println("• Type 'test' in Serial Monitor to send an instant test SMS.");
  Serial.println("==========================================\n");
}

void loop() {
  feedGPS();
  readGsmStream();
  readSerialMonitorCommands();
  updateLedStatus();

  // Poll cloud server command queue every 5s
  if (millis() - lastPollTime >= POLL_MS) {
    pollServerCommand();
  }

  // When SOS is active, send periodic updates
  if (sosActive) {
    // Safeguard timeout after 30 minutes
    if (millis() - sosStart > SOS_MAX_MS) {
      stopSOS("TIMEOUT (30 MIN)");
      return;
    }

    // Stream live location to cloud every 10s
    if (millis() - lastPostTime >= POST_UPDATE_MS) {
      postLocationToCloud("sos_update");
    }

    // Send repeat SMS update every 60s
    if (millis() - lastSmsTime >= SMS_REPEAT_MS) {
      sendEmergencySmsToAll("SOS UPDATE:");
    }
  }

  yield();
}
