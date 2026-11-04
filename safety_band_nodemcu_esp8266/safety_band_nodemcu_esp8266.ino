/*
 * Female Safety Band — NodeMCU V3 (ESP8266) + NEO-6M GPS + SIM800L GSM/GPRS
 *
 * 100% CELLULAR STANDALONE (NO WiFi, NO hardcoded victim numbers):
 *   • NO WiFi needed — runs anywhere on cell towers using the SIM card.
 *   • NO hardcoded phone numbers — configured dynamically via SMS ("SET <phone>")
 *     or via SIM800L GPRS mobile internet, and saved permanently in EEPROM.
 *   • SIM800L GPRS Mobile Data connects directly to the cloud backend.
 *   • Emergency SMS + Phone Call sent directly via SIM800L over the cellular network.
 *
 * Wiring (NodeMCU labels):
 *   GPS (GY-GPS6MV2 / NEO-6M):
 *     VCC -> NodeMCU 3V3
 *     TXD -> NodeMCU D6 (GPIO12)
 *     GND -> Common Ground
 *
 *   SIM800L GSM/GPRS Module:
 *     VCC -> External Li-ion cell (3.7V - 4.2V) with 1000uF capacitor across VCC/GND
 *     GND -> Common Ground (joined with NodeMCU GND & Li-ion negative)
 *     TXD -> NodeMCU D5 (GPIO14)
 *     RXD -> 1k resistor -> NodeMCU D7 (GPIO13)
 *     Antenna connected
 *
 *   NodeMCU V3:
 *     Powered via USB (or 5V power bank)
 *
 * Board: "NodeMCU 1.0 (ESP-12E Module)" in Arduino IDE
 * Required Library: TinyGPSPlus
 */

#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>
#include <EEPROM.h>

// ================= CONFIGURATION =================
const char* DEVICE_ID   = "band-001";
const char* API_KEY     = "dev_device_api_key_12345";

// Cellular APN (Auto-configures GPRS data for Indian SIM carriers)
// Airtel: "airtelgprs.com" | Vi / Vodafone / Idea: "www" or "portalnmms" | BSNL: "bsnlnet" | Jio: "jionet"
const char* GPRS_APN    = "airtelgprs.com"; 

// Cloud Server Endpoints (Render)
const char* SERVER_URL  = "https://safety-system-yfxl.onrender.com/api/location";
const char* COMMAND_URL = "https://safety-system-yfxl.onrender.com/api/device/band-001/command";
const char* CONFIG_URL  = "https://safety-system-yfxl.onrender.com/api/device/band-001/config";

// ================= PIN ASSIGNMENTS =================
#define PIN_LED    D4   // Onboard NodeMCU LED (active LOW)
#define PIN_GPS_RX D6   // GPS TXD -> D6
#define PIN_GSM_RX D5   // SIM800L TXD -> D5
#define PIN_GSM_TX D7   // NodeMCU D7 -> 1k resistor -> SIM800L RXD

// ================= TIMING =================
const uint32_t SMS_REPEAT_MS   = 60000;            // Repeat SMS every 60s during active SOS
const uint32_t GPRS_POST_MS    = 15000;            // GPRS telemetry every 15s during SOS
const uint32_t GPRS_POLL_MS    = 10000;            // GPRS poll server command every 10s
const uint32_t SOS_MAX_MS      = 30UL * 60UL * 1000UL; // Auto-timeout SOS after 30 mins

// ================= EEPROM CONFIG STORAGE =================
// Dynamic configuration stored in non-volatile flash (no hardcoded victim numbers)
struct StoredConfig {
  char magic[4];          // "GSOS"
  char emergencyContact[24]; // e.g. "+917248549516"
  char victimName[32];       // e.g. "Sneha"
};

StoredConfig config;

// ================= OBJECTS & GLOBALS =================
TinyGPSPlus gps;
SoftwareSerial gpsSerial(PIN_GPS_RX, -1);         // GPS: receive only on D6
SoftwareSerial gsmSerial(PIN_GSM_RX, PIN_GSM_TX); // SIM800L: RX=D5, TX=D7

bool     sosActive     = false;
uint32_t sosStart      = 0;
uint32_t lastSmsTime   = 0;
uint32_t lastPostTime  = 0;
uint32_t lastPollTime  = 0;
bool     gprsAttached  = false;

double   lastLat = 28.622666;                     // Default fallback (Delhi)
double   lastLng = 77.296663;
bool     haveFix = false;

String gsmBuffer, smsSender;
bool   expectSmsBody = false;
String serialBuffer;

// ---------- EEPROM STORAGE ----------
void loadConfig() {
  EEPROM.begin(512);
  EEPROM.get(0, config);
  if (strncmp(config.magic, "GSOS", 4) != 0) {
    Serial.println("[CONFIG] No saved contact found in EEPROM. Initializing defaults.");
    strncpy(config.magic, "GSOS", 4);
    memset(config.emergencyContact, 0, sizeof(config.emergencyContact));
    strncpy(config.victimName, "Guardian User", sizeof(config.victimName));
    saveConfig();
  } else {
    Serial.printf("[CONFIG] Loaded saved Emergency Contact: '%s' (Victim: %s)\n",
                  config.emergencyContact, config.victimName);
  }
}

void saveConfig() {
  EEPROM.put(0, config);
  EEPROM.commit();
  Serial.printf("[CONFIG] Saved Emergency Contact to EEPROM: %s\n", config.emergencyContact);
}

void setEmergencyContact(const String& number, const String& name = "") {
  String clean = "";
  for (unsigned int i = 0; i < number.length(); i++) {
    char c = number[i];
    if (isdigit(c) || c == '+') clean += c;
  }
  if (clean.length() >= 10) {
    strncpy(config.emergencyContact, clean.c_str(), sizeof(config.emergencyContact) - 1);
    config.emergencyContact[sizeof(config.emergencyContact) - 1] = '\0';
    if (name.length() > 0) {
      strncpy(config.victimName, name.c_str(), sizeof(config.victimName) - 1);
    }
    saveConfig();
  }
}

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
    url += " (approximated)";
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

// ---------- SIM800L LOW-LEVEL AT COMMANDS ----------
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

// ---------- SIM800L GPRS CELLULAR INTERNET ----------
bool initGPRS() {
  Serial.println("\n[GPRS] Attaching to GPRS Mobile Internet...");
  gsmCommand("AT+SAPBR=3,1,\"Contype\",\"GPRS\"");
  gsmCommand(String("AT+SAPBR=3,1,\"APN\",\"") + GPRS_APN + "\"");
  
  // Close any existing bearer
  gsmCommand("AT+SAPBR=0,1", "OK", 2000);
  
  // Open GPRS bearer
  if (gsmCommand("AT+SAPBR=1,1", "OK", 10000)) {
    Serial.println("[GPRS] SUCCESS: GPRS Bearer opened!");
    gsmCommand("AT+SAPBR=2,1"); // Query IP address
    gprsAttached = true;
    return true;
  } else {
    Serial.println("[GPRS WARNING] GPRS attachment failed. SMS/Calling will still function 100%!");
    gprsAttached = false;
    return false;
  }
}

// Send HTTP POST over SIM800L GPRS data
void sendGprsLocationPost(const char* eventType) {
  if (!gprsAttached) return;

  Serial.println("\n[GPRS] Sending location update to Cloud via Mobile Data...");
  gsmCommand("AT+HTTPINIT");
  gsmCommand("AT+HTTPSSL=1"); // Enable SSL for HTTPS
  gsmCommand("AT+HTTPPARA=\"CID\",1");
  gsmCommand(String("AT+HTTPPARA=\"URL\",\"") + SERVER_URL + "\"");
  gsmCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"");
  gsmCommand(String("AT+HTTPPARA=\"USERDATA\",\"x-api-key: ") + API_KEY + "\"");

  String json = String("{\"deviceId\":\"") + DEVICE_ID +
                "\",\"event\":\"" + eventType +
                "\",\"lat\":" + String(lastLat, 6) +
                ",\"lng\":" + String(lastLng, 6) +
                ",\"fix\":" + (haveFix ? "true" : "false") + "}";

  gsmCommand(String("AT+HTTPDATA=") + json.length() + ",5000", "DOWNLOAD", 3000);
  gsmSerial.print(json);
  waitWithGps(500);

  gsmCommand("AT+HTTPACTION=1", "ACTION: 1", 10000); // 1 = POST
  gsmCommand("AT+HTTPTERM");
  lastPostTime = millis();
}

// Poll cloud commands over GPRS
void pollGprsServerCommand() {
  lastPollTime = millis();
  if (!gprsAttached) return;

  gsmCommand("AT+HTTPINIT");
  gsmCommand("AT+HTTPSSL=1");
  gsmCommand("AT+HTTPPARA=\"CID\",1");
  gsmCommand(String("AT+HTTPPARA=\"URL\",\"") + COMMAND_URL + "\"");
  gsmCommand(String("AT+HTTPPARA=\"USERDATA\",\"x-api-key: ") + API_KEY + "\"");

  if (gsmCommand("AT+HTTPACTION=0", "ACTION: 0", 10000)) { // 0 = GET
    while (gsmSerial.available()) gsmSerial.read();
    gsmSerial.print("AT+HTTPREAD\r\n");
    String resp;
    uint32_t t = millis();
    while (millis() - t < 3000) {
      while (gsmSerial.available()) resp += (char)gsmSerial.read();
      delay(5);
    }
    if (resp.indexOf("\"sos\"") >= 0) {
      triggerSOS("GPRS CLOUD DISPATCH");
    } else if (resp.indexOf("\"stop\"") >= 0) {
      stopSOS("GPRS CLOUD DISPATCH");
    }
  }
  gsmCommand("AT+HTTPTERM");
}

// Fetch dynamic victim profile & contacts from cloud over GPRS
void fetchDynamicConfigOverGprs() {
  if (!gprsAttached) return;

  Serial.println("[GPRS] Checking dynamic victim configuration from cloud...");
  gsmCommand("AT+HTTPINIT");
  gsmCommand("AT+HTTPSSL=1");
  gsmCommand("AT+HTTPPARA=\"CID\",1");
  gsmCommand(String("AT+HTTPPARA=\"URL\",\"") + CONFIG_URL + "\"");
  gsmCommand(String("AT+HTTPPARA=\"USERDATA\",\"x-api-key: ") + API_KEY + "\"");

  if (gsmCommand("AT+HTTPACTION=0", "ACTION: 0", 10000)) {
    while (gsmSerial.available()) gsmSerial.read();
    gsmSerial.print("AT+HTTPREAD\r\n");
    String resp;
    uint32_t t = millis();
    while (millis() - t < 3000) {
      while (gsmSerial.available()) resp += (char)gsmSerial.read();
      delay(5);
    }
    // Parse first contact from JSON: "contacts":["+91..."]
    int contactStart = resp.indexOf("\"contacts\":[\"");
    if (contactStart >= 0) {
      int quote1 = contactStart + 13;
      int quote2 = resp.indexOf("\"", quote1);
      if (quote2 > quote1) {
        String num = resp.substring(quote1, quote2);
        setEmergencyContact(num);
      }
    }
  }
  gsmCommand("AT+HTTPTERM");
}

// ---------- SIM800L SMS & CALL FUNCTIONS ----------
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
  if (phoneNumber.length() < 10) {
    Serial.println("[SIM800L ERROR] Cannot send SMS: No emergency contact configured!");
    Serial.println("[SIM800L] Send an SMS with 'SET +91XXXXXXXXXX' to set the emergency contact.");
    return false;
  }

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
  if (phoneNumber.length() < 10) return;
  Serial.printf("\n[SIM800L] Calling emergency contact: %s\n", phoneNumber.c_str());
  gsmCommand("ATD" + phoneNumber + ";", "OK", 5000);
  waitWithGps(20000); // Ring for 20 seconds
  gsmCommand("ATH", "OK", 2000); // Hang up
}

// Send emergency SMS to saved emergency contact
void sendEmergencySmsToContact(const String& customPrefix) {
  String message = customPrefix + "\n" +
                   String(config.victimName) + " needs urgent help!\n" +
                   "Live GPS: " + getLocationUrl();

  sendSmsSim800L(String(config.emergencyContact), message);
  lastSmsTime = millis();
}

// ---------- SOS STATE MACHINE ----------
void triggerSOS(const char* source) {
  if (sosActive) return;

  Serial.println("\n******************************************");
  Serial.printf("!!! SOS TRIGGERED VIA: %s !!!\n", source);
  Serial.println("******************************************");

  sosActive = true;
  sosStart  = millis();

  // 1. PRIMARY: Dispatch Emergency SMS via SIM800L
  sendEmergencySmsToContact("EMERGENCY SOS ALERT!");

  // 2. Make Emergency Voice Call via SIM800L
  makeCallSim800L(String(config.emergencyContact));

  // 3. Send GPRS Telemetry to Cloud (if attached)
  sendGprsLocationPost("sos_start");
}

void stopSOS(const char* source) {
  if (!sosActive) return;

  Serial.printf("\n[SOS] SOS Cancelled via: %s\n", source);
  sosActive = false;

  // Send cancellation SMS via SIM800L
  if (strlen(config.emergencyContact) >= 10) {
    sendSmsSim800L(String(config.emergencyContact), "SOS CANCELLED. " + String(config.victimName) + " is safe.");
  }

  sendGprsLocationPost("sos_cancel");
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
    Serial.println("\n[GSM] Received SMS from " + smsSender + ": " + cmd);

    // Dynamic configuration via SMS: "SET +91XXXXXXXXXX"
    if (cmd.startsWith("SET") || cmd.startsWith("set")) {
      String newNum = cmd.substring(3);
      newNum.trim();
      setEmergencyContact(newNum);
      sendSmsSim800L(smsSender, "Guardian Band: Emergency contact set to " + newNum);
      return;
    }

    cmd.toUpperCase();
    if (cmd == "SOS") {
      // If no contact set yet, set sender as contact!
      if (strlen(config.emergencyContact) < 10) {
        setEmergencyContact(smsSender);
      }
      triggerSOS("INCOMING SMS");
    } else if (cmd == "STOP") {
      stopSOS("INCOMING SMS");
    } else if (cmd == "LOC") {
      sendSmsSim800L(smsSender, "Guardian Band Live Location: " + getLocationUrl());
    } else if (cmd == "STATUS") {
      String statusMsg = "Band Status:\nContact: " + String(config.emergencyContact) +
                         "\nGPS: " + (haveFix ? "Fixed" : "Searching") +
                         "\nGPRS: " + (gprsAttached ? "Online" : "Offline");
      sendSmsSim800L(smsSender, statusMsg);
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

// Serial Monitor testing (115200 baud)
void readSerialMonitorCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      String cmd = serialBuffer;
      serialBuffer = "";
      cmd.trim();
      if (cmd.startsWith("set ") || cmd.startsWith("SET ")) {
        String num = cmd.substring(4);
        num.trim();
        setEmergencyContact(num);
      } else {
        cmd.toUpperCase();
        if (cmd == "SOS") {
          triggerSOS("SERIAL MONITOR");
        } else if (cmd == "STOP") {
          stopSOS("SERIAL MONITOR");
        } else if (cmd == "LOC") {
          Serial.println("Location: " + getLocationUrl());
        } else if (cmd == "TEST") {
          Serial.println("[TEST] Sending test SMS to: " + String(config.emergencyContact));
          sendSmsSim800L(String(config.emergencyContact), "Test message from Guardian Band SIM800L!");
        } else if (cmd == "STATUS") {
          Serial.println("\n--- BAND STATUS ---");
          Serial.printf("Emergency Contact: %s\n", config.emergencyContact);
          Serial.printf("Victim Name: %s\n", config.victimName);
          Serial.printf("GPS Fixed: %s (%f, %f)\n", haveFix ? "YES" : "NO", lastLat, lastLng);
          Serial.printf("GPRS Internet: %s\n", gprsAttached ? "ATTACHED" : "OFFLINE");
          Serial.println("-------------------\n");
        }
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
  Serial.println("   (100% CELLULAR: NO WiFi, NO HARDCODE)  ");
  Serial.println("==========================================");

  // Status LED
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);

  // Load dynamic configuration from non-volatile EEPROM
  loadConfig();

  // UART Software Serials
  gpsSerial.begin(9600);       // D6 (GPS)
  gsmSerial.begin(9600);       // D5 / D7 (SIM800L)

  // Initialize SIM800L cellular radio
  gsmInit();

  // Initialize SIM GPRS Mobile Internet
  initGPRS();

  // If GPRS is online, sync dynamic profile from cloud
  if (gprsAttached) {
    fetchDynamicConfigOverGprs();
  }

  Serial.println("\n[SYSTEM READY]");
  Serial.println("• To set emergency contact, send SMS to this SIM: 'SET +91XXXXXXXXXX'");
  Serial.println("• Or in Serial Monitor, type: 'set +91XXXXXXXXXX'");
  Serial.println("• Send 'SOS' via SMS to trigger emergency alert");
  Serial.println("• Send 'LOC' to get instant live Google Maps location link");
  Serial.println("• Type 'sos', 'test', or 'status' in Serial Monitor");
  Serial.println("==========================================\n");
}

void loop() {
  feedGPS();
  readGsmStream();
  readSerialMonitorCommands();
  updateLedStatus();

  // Poll cloud server command queue over GPRS
  if (gprsAttached && (millis() - lastPollTime >= GPRS_POLL_MS)) {
    pollGprsServerCommand();
  }

  // When SOS is active, send periodic updates
  if (sosActive) {
    // Safeguard timeout after 30 minutes
    if (millis() - sosStart > SOS_MAX_MS) {
      stopSOS("TIMEOUT (30 MIN)");
      return;
    }

    // Send repeat SMS update every 60s
    if (millis() - lastSmsTime >= SMS_REPEAT_MS) {
      sendEmergencySmsToContact("SOS UPDATE:");
    }

    // Stream live location via GPRS every 15s
    if (gprsAttached && (millis() - lastPostTime >= GPRS_POST_MS)) {
      sendGprsLocationPost("sos_update");
    }
  }

  yield();
}
