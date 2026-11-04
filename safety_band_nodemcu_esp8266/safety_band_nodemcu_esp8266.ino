/*
 * Female Safety Band — Universal Central Dispatch Band
 * Hardware: NodeMCU V3 (ESP8266) + NEO-6M GPS + SIM800L GSM
 *
 * HOW IT WORKS (Universal Multi-User Architecture):
 *   1. ANY registered user logs into the mobile app and taps SOS.
 *   2. The cloud server receives the SOS with the victim's name, phone,
 *      emergency contact number, and live GPS coordinates.
 *   3. This band polls the server every 3 seconds over WiFi/Hotspot.
 *   4. The band's SIM800L GSM module INSTANTLY sends the emergency SMS
 *      and places a phone call to the victim's emergency contact!
 *   5. Standalone SMS fallback: Anyone can text "SOS" or "LOC" to this SIM card,
 *      and the band will reply with the live Google Maps location.
 *
 * Wiring (as per schematic):
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
 * Board: "NodeMCU 1.0 (ESP-12E Module)" in Arduino IDE
 * Required Library: TinyGPSPlus
 */

#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>

// ================= CONFIGURATION =================
const char* DEVICE_ID   = "band-001";
const char* API_KEY     = "dev_device_api_key_12345";

// WiFi / Phone Hotspot (Redmi Note 12 Pro+ 5G)
const char* WIFI_SSID   = "Redmi Note 12 Pro+ 5G";
const char* WIFI_PASS   = "Whatyoudo";

// Cloud Server Endpoints (Render)
const char* SERVER_URL  = "https://safety-system-yfxl.onrender.com/api/location";
const char* COMMAND_URL = "https://safety-system-yfxl.onrender.com/api/device/band-001/command";

// ================= PIN ASSIGNMENTS =================
#define PIN_LED    D4   // Onboard NodeMCU LED (active LOW)
#define PIN_GPS_RX D6   // GPS TXD -> D6
#define PIN_GSM_RX D5   // SIM800L TXD -> D5
#define PIN_GSM_TX D7   // NodeMCU D7 -> 1k resistor -> SIM800L RXD

// ================= TIMING =================
const uint32_t POLL_MS         = 3000;             // Poll cloud server command queue every 3 seconds
const uint32_t POST_UPDATE_MS  = 10000;            // Live GPS stream every 10s during SOS
const uint32_t SOS_MAX_MS      = 30UL * 60UL * 1000UL; // Auto-timeout SOS after 30 mins

// ================= OBJECTS & GLOBALS =================
TinyGPSPlus gps;
SoftwareSerial gpsSerial(PIN_GPS_RX, -1);         // GPS: receive only on D6
SoftwareSerial gsmSerial(PIN_GSM_RX, PIN_GSM_TX); // SIM800L: RX=D5, TX=D7
WiFiClientSecure secureClient;

bool     sosActive     = false;
uint32_t sosStart      = 0;
uint32_t lastPostTime  = 0;
uint32_t lastPollTime  = 0;

double   lastLat = 28.622666;                     // Default fallback (Delhi)
double   lastLng = 77.296663;
bool     haveFix = false;

String gsmBuffer, smsSender;
bool   expectSmsBody = false;
String serialBuffer;

// Active incident target info from cloud dispatch
String activeTargetPhone = "+917248549516";
String activeVictimName  = "Guardian User";
String activeVictimPhone = "+919599891970";

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

String getLocationUrl(double lat, double lng) {
  return "https://maps.google.com/?q=" + String(lat, 6) + "," + String(lng, 6);
}

// ---------- ONBOARD LED STATUS ----------
void updateLedStatus() {
  if (sosActive) {
    // SOS active: Fast flashing LED (150ms)
    digitalWrite(PIN_LED, (millis() / 150) % 2 ? LOW : HIGH);
  } else if (WiFi.status() == WL_CONNECTED && gps.location.isValid()) {
    // WiFi connected & GPS fix: Solid ON (active LOW)
    digitalWrite(PIN_LED, LOW);
  } else {
    // Searching: Slow pulse (600ms)
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
  waitWithGps(1500);

  // Auto-baud synchronization
  long bauds[] = {9600, 115200, 4800, 19200};
  bool synced = false;

  for (int b = 0; b < 4 && !synced; b++) {
    gsmSerial.begin(bauds[b]);
    delay(100);
    for (int i = 0; i < 3; i++) {
      gsmSerial.print("AT\r\n");
      delay(150);
      String r = "";
      while (gsmSerial.available()) r += (char)gsmSerial.read();
      if (r.indexOf("OK") >= 0) {
        Serial.printf("[GSM] Found SIM800L at %ld baud!\n", bauds[b]);
        synced = true;
        if (bauds[b] != 9600) {
          gsmSerial.print("AT+IPR=9600\r\n");
          delay(200);
          gsmSerial.begin(9600);
        }
        break;
      }
    }
  }

  if (!synced) {
    Serial.println("[GSM ERROR] SIM800L not responding! Check Li-ion battery (3.7-4.2V), 1000uF cap, and D5/D7 wiring.");
    return false;
  }

  gsmCommand("ATE0");                   // Echo off
  gsmCommand("AT+CMGF=1");              // Set SMS to text mode
  gsmCommand("AT+CSCS=\"GSM\"");        // GSM standard character set
  gsmCommand("AT+CNMI=2,2,0,0,0");      // Direct SMS delivery to serial
  gsmCommand("AT+CPIN?");               // Check SIM card status
  gsmCommand("AT+CSQ");                 // Check signal strength

  Serial.println("[GSM] Checking cellular network registration...");
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

// Send SMS directly through the SIM800L module
bool sendSmsSim800L(const String& phoneNumber, const String& text) {
  if (phoneNumber.length() < 10) {
    Serial.println("[SIM800L ERROR] Cannot send SMS: Invalid target phone number!");
    return false;
  }

  Serial.println("\n=======================================================");
  Serial.printf("[SIM800L] SENDING EMERGENCY SMS DIRECTLY TO: %s\n", phoneNumber.c_str());
  Serial.println("=======================================================");

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
    Serial.println("\n[SIM800L] *** EMERGENCY SMS SUCCESSFULLY DELIVERED! ***\n");
  } else {
    Serial.println("\n[SIM800L ERROR] SMS failed or cell tower timeout: " + resp);
  }
  return confirmed;
}

// Make emergency phone call via SIM800L
void makeCallSim800L(const String& phoneNumber) {
  if (phoneNumber.length() < 10) return;
  Serial.printf("\n[SIM800L] Calling emergency contact: %s\n", phoneNumber.c_str());
  gsmCommand("ATD" + phoneNumber + ";", "OK", 5000);
  waitWithGps(20000); // Ring for 20 seconds
  gsmCommand("ATH", "OK", 2000); // Hang up
}

// ---------- LIGHTWEIGHT JSON FIELD PARSER ----------
String extractJsonField(const String& json, const String& field) {
  String search = "\"" + field + "\":";
  int idx = json.indexOf(search);
  if (idx < 0) return "";
  int valStart = idx + search.length();
  while (valStart < (int)json.length() && (json[valStart] == ' ' || json[valStart] == '\t')) valStart++;
  
  if (valStart < (int)json.length() && json[valStart] == '"') {
    valStart++;
    int valEnd = json.indexOf('"', valStart);
    if (valEnd > valStart) return json.substring(valStart, valEnd);
    return "";
  }
  
  int valEnd = valStart;
  while (valEnd < (int)json.length() && json[valEnd] != ',' && json[valEnd] != '}' && json[valEnd] != ' ') {
    valEnd++;
  }
  return json.substring(valStart, valEnd);
}

// ---------- CLOUD SERVER (RENDER) ----------
void postLocationToCloud(const char* eventType) {
  if (WiFi.status() != WL_CONNECTED) return;

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
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Disconnected. Reconnecting to hotspot...");
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    return;
  }

  HTTPClient http;
  if (!http.begin(secureClient, COMMAND_URL)) return;

  http.setTimeout(3500);
  http.addHeader("x-api-key", API_KEY);
  int code = http.GET();
  String payload = (code == 200) ? http.getString() : "";
  http.end();

  if (code == 200 && payload.indexOf("\"none\"") < 0) {
    Serial.printf("\n[CLOUD COMMAND RECEIVED]: %s\n", payload.c_str());

    String cmd = extractJsonField(payload, "command");

    if (cmd == "sos") {
      // Extract dynamic victim and emergency contact details
      String targetPhone = extractJsonField(payload, "targetPhone");
      String victimName  = extractJsonField(payload, "victimName");
      String victimPhone = extractJsonField(payload, "victimPhone");
      String latStr      = extractJsonField(payload, "lat");
      String lngStr      = extractJsonField(payload, "lng");

      if (targetPhone.length() >= 10) activeTargetPhone = targetPhone;
      if (victimName.length() > 0)    activeVictimName  = victimName;
      if (victimPhone.length() >= 10) activeVictimPhone = victimPhone;

      double alertLat = (latStr.length() > 0) ? latStr.toDouble() : lastLat;
      double alertLng = (lngStr.length() > 0) ? lngStr.toDouble() : lastLng;

      // Trigger the SIM800L to send the emergency SMS immediately!
      triggerSosFromApp(activeVictimName, activeVictimPhone, activeTargetPhone, alertLat, alertLng);
    } 
    else if (cmd == "stop") {
      stopSOS("CLOUD DISPATCH (RESOLVED)");
    }
  }
}

// ---------- SOS DISPATCH LOGIC ----------
void triggerSosFromApp(const String& victim, const String& vPhone, const String& target, double lat, double lng) {
  sosActive = true;
  sosStart  = millis();

  Serial.println("\n*******************************************************");
  Serial.printf("!!! SOS ACTIVATED FOR VICTIM: %s (%s) !!!\n", victim.c_str(), vPhone.c_str());
  Serial.printf("!!! DISPATCHING SIM800L EMERGENCY SMS TO: %s !!!\n", target.c_str());
  Serial.println("*******************************************************");

  String mapUrl = getLocationUrl(lat, lng);
  String alertMsg = "EMERGENCY SOS ALERT!\n" +
                    victim + " (" + vPhone + ") needs immediate help!\n" +
                    "Live Location: " + mapUrl;

  // 1. Send SMS via SIM800L directly to the contact's phone
  sendSmsSim800L(target, alertMsg);

  // 2. Make emergency phone call via SIM800L
  makeCallSim800L(target);

  // 3. Confirm back to cloud server
  postLocationToCloud("sos_start");
}

void stopSOS(const char* source) {
  if (!sosActive) return;

  Serial.printf("\n[SOS] Cancelled via: %s\n", source);
  sosActive = false;

  // Send cancellation SMS via SIM800L
  if (activeTargetPhone.length() >= 10) {
    sendSmsSim800L(activeTargetPhone, "SOS CANCELLED. " + activeVictimName + " is safe now.");
  }

  postLocationToCloud("sos_cancel");
}

// ---------- INCOMING SMS COMMANDS ----------
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
    String cmd = l;
    cmd.trim();
    cmd.toUpperCase();
    Serial.println("\n[GSM] Received SMS from " + smsSender + ": " + cmd);

    if (cmd == "SOS") {
      triggerSosFromApp("Owner", smsSender, smsSender, lastLat, lastLng);
    } else if (cmd == "STOP") {
      stopSOS("INCOMING SMS");
    } else if (cmd == "LOC") {
      sendSmsSim800L(smsSender, "Guardian Band Location: " + getLocationUrl(lastLat, lastLng));
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

// Serial Monitor commands for bench testing
void readSerialMonitorCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      String cmd = serialBuffer;
      serialBuffer = "";
      cmd.trim();
      cmd.toUpperCase();
      if (cmd == "SOS") {
        triggerSosFromApp("Sneha", "9599891970", activeTargetPhone, lastLat, lastLng);
      } else if (cmd == "STOP") {
        stopSOS("SERIAL MONITOR");
      } else if (cmd == "TEST") {
        Serial.println("[TEST] Sending test SMS to: " + activeTargetPhone);
        sendSmsSim800L(activeTargetPhone, "Test SMS from Guardian Band SIM800L module!");
      } else if (cmd == "LOC") {
        Serial.println("Location: " + getLocationUrl(lastLat, lastLng));
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
  Serial.println("   (UNIVERSAL MULTI-USER CLOUD DISPATCH)  ");
  Serial.println("==========================================");

  // Status LED
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);

  // Secure client for Render HTTPS
  secureClient.setInsecure();

  // UART Software Serials
  gpsSerial.begin(9600);       // D6 (GPS)
  gsmSerial.begin(9600);       // D5 / D7 (SIM800L)

  // Connect to phone hotspot / WiFi
  if (strlen(WIFI_SSID) > 0) {
    Serial.printf("[WIFI] Connecting to '%s'...\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }

  // Initialize SIM800L module
  gsmInit();

  Serial.println("\n[SYSTEM READY]");
  Serial.println("• Whenever ANY user taps SOS in the app, the SIM800L sends the SMS to their phone!");
  Serial.println("• Type 'test' in Serial Monitor to send an instant test SMS to " + activeTargetPhone);
  Serial.println("• Type 'sos' in Serial Monitor to trigger full emergency sequence.");
  Serial.println("==========================================\n");
}

void loop() {
  feedGPS();
  readGsmStream();
  readSerialMonitorCommands();
  updateLedStatus();

  // Poll cloud server command queue every 3s
  if (millis() - lastPollTime >= POLL_MS) {
    pollServerCommand();
  }

  // Periodic location streaming while SOS is active
  if (sosActive) {
    if (millis() - sosStart > SOS_MAX_MS) {
      stopSOS("TIMEOUT (30 MIN)");
      return;
    }

    if (millis() - lastPostTime >= POST_UPDATE_MS) {
      postLocationToCloud("sos_update");
    }
  }

  yield();
}
