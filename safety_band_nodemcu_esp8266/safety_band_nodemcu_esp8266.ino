/*
 * Female Safety Band - LOLIN NodeMCU V3 (ESP8266) + NEO-6M (GY-GPS6MV2) + SIM800L
 * (no button, no buzzer - SOS is triggered remotely)
 *
 * Wiring (NodeMCU labels):
 *   GPS  TXD  -> D6          GPS VCC -> 3V3, GND -> GND  (GPS RXD not needed)
 *   SIM800L TXD -> D5        SIM800L RXD -> 2k resistor -> D7
 *   SIM800L VCC -> Li-ion cell 3.7-4.2V (+1000uF cap), GND common with NodeMCU
 *
 * Board: "NodeMCU 1.0 (ESP-12E Module)"   Library: TinyGPSPlus
 *
 * HOW SOS IS TRIGGERED (any of these):
 *   1. SMS to the band's SIM from OWNER_NUMBER or a CONTACT:
 *        SOS   -> start SOS (SMS + call + server updates)
 *        STOP  -> cancel SOS
 *        LOC   -> reply once with current location
 *   2. The app/server: band polls COMMAND_URL over WiFi (phone hotspot)
 *        server answers {"command":"sos"} / {"command":"stop"} / {"command":"none"}
 *   3. Serial Monitor (115200): type sos / stop / loc   (bench testing)
 *
 * While SOS is active: SMS update every 60s, server POST every 10s (max 30 min).
 * LED: slow blink = no GPS fix, solid = GPS fix, fast blink = SOS active.
 */

#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

// ================= CONFIG =================
const char* OWNER_NUMBER = "+919599891970";                      // her own phone (can send SOS/STOP/LOC)
const char* CONTACTS[]   = {"+917248549516"};                   // emergency contacts (get alerts, can send commands)
const int   NUM_CONTACTS = 1;

const char* DEVICE_ID  = "band-001";

// WiFi (phone hotspot or home router)
// Set your WiFi / Phone Hotspot name & password so ESP8266 connects to the same network as your laptop
const char* WIFI_SSID   = "Redmi Note 12 Pro+ 5G";
const char* WIFI_PASS   = "Whatyoudo";

// Local Server Endpoints (Your Laptop Local IP: 10.182.192.138)
const char* SERVER_URL  = "http://10.182.192.138:3000/api/location";
const char* COMMAND_URL = "http://10.182.192.138:3000/api/device/band-001/command";

// API Key (must match DEVICE_API_KEY on the server / .env)
const char* API_KEY     = "dev_device_api_key_12345";

// ================= PINS ===================
#define GPS_RX   D6   // NodeMCU RX <- GPS TXD
#define GSM_RX   D5   // NodeMCU RX <- SIM800L TXD
#define GSM_TX   D7   // NodeMCU TX -> SIM800L RXD (through resistor)
#define LED_PIN  D4   // onboard LED (active LOW)

// ================= TIMING =================
const uint32_t SMS_UPDATE_MS  = 60000;
const uint32_t POST_UPDATE_MS = 10000;
const uint32_t POLL_MS        = 5000;
const uint32_t SOS_MAX_MS     = 30UL * 60UL * 1000UL;

TinyGPSPlus gps;
SoftwareSerial gpsSerial(GPS_RX, -1);        // receive only
SoftwareSerial gsmSerial(GSM_RX, GSM_TX);
WiFiClient plainClient;
WiFiClientSecure secureClient;

bool     sosActive = false;
uint32_t sosStart = 0, lastSms = 0, lastPost = 0, lastPoll = 0;
double   lastLat = 0, lastLng = 0;
bool     haveFix = false;

String gsmLine, smsSender;
bool   expectBody = false;
String serialLine;

// ---------- GPS ----------
void feedGPS() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());
  if (gps.location.isValid()) {
    lastLat = gps.location.lat();
    lastLng = gps.location.lng();
    haveFix = true;
  }
}

void waitMs(uint32_t ms) {            // delay that keeps feeding GPS
  uint32_t t = millis();
  while (millis() - t < ms) { feedGPS(); delay(5); }
}

String locationText() {
  if (!haveFix) return "Location unavailable (no GPS fix yet).";
  String s = gps.location.isValid() ? "Live location: " : "Last known location: ";
  s += "https://maps.google.com/?q=" + String(lastLat, 6) + "," + String(lastLng, 6);
  return s;
}

// ---------- LED ----------
void ledBlink(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, LOW);  delay(150);
    digitalWrite(LED_PIN, HIGH); delay(150);
  }
}

// ---------- GSM ----------
bool gsmWait(const char* expect, uint32_t timeout) {
  String buf;
  uint32_t t = millis();
  while (millis() - t < timeout) {
    while (gsmSerial.available()) buf += (char)gsmSerial.read();
    if (buf.indexOf(expect) >= 0) return true;
    feedGPS();
    delay(10);
  }
  Serial.println("GSM timeout, got: " + buf);
  return false;
}

bool gsmCmd(const String& cmd, const char* expect = "OK", uint32_t timeout = 2000) {
  while (gsmSerial.available()) gsmSerial.read();   // flush
  gsmSerial.print(cmd);
  gsmSerial.print("\r");
  return gsmWait(expect, timeout);
}

bool networkReady() {
  while (gsmSerial.available()) gsmSerial.read();
  gsmSerial.print("AT+CREG?\r");
  String buf;
  uint32_t t = millis();
  while (millis() - t < 1500) {
    while (gsmSerial.available()) buf += (char)gsmSerial.read();
    feedGPS();
    delay(10);
  }
  return buf.indexOf(",1") >= 0 || buf.indexOf(",5") >= 0;   // home or roaming
}

bool gsmInit() {
  waitMs(3000);
  bool ok = false;
  for (int i = 0; i < 10 && !ok; i++) ok = gsmCmd("AT");
  if (!ok) return false;
  gsmCmd("ATE0");                     // echo off
  gsmCmd("AT+CMGF=1");                // SMS text mode
  gsmCmd("AT+CSCS=\"GSM\"");
  gsmCmd("AT+CNMI=2,2,0,0,0");        // deliver incoming SMS straight to serial (+CMT)
  gsmCmd("AT+CMGD=1,4");              // delete old stored SMS
  return true;
}

bool sendSMS(const String& number, const String& text) {
  Serial.println("SMS -> " + number);
  if (!gsmCmd("AT+CMGS=\"" + number + "\"", ">", 5000)) return false;
  gsmSerial.print(text);
  gsmSerial.write(26);                // Ctrl+Z
  return gsmWait("OK", 15000);
}

void makeCall(const String& number) {
  Serial.println("CALL -> " + number);
  gsmCmd("ATD" + number + ";", "OK", 5000);
  waitMs(25000);                      // ring for ~25s
  gsmCmd("ATH");                      // hang up
}

void smsAll(const String& header) {
  String msg = header + "\n" + locationText();
  for (int i = 0; i < NUM_CONTACTS; i++) sendSMS(CONTACTS[i], msg);
  lastSms = millis();
}

// ---------- AUTHORISATION ----------
String last10(const String& n) {
  String d;
  for (unsigned int i = 0; i < n.length(); i++) if (isdigit(n[i])) d += n[i];
  return d.length() > 10 ? d.substring(d.length() - 10) : d;
}

bool isAuthorized(const String& number) {
  String x = last10(number);
  if (x.length() < 10) return false;
  if (x == last10(OWNER_NUMBER)) return true;
  for (int i = 0; i < NUM_CONTACTS; i++) if (x == last10(CONTACTS[i])) return true;
  return false;
}

// ---------- SERVER ----------
bool httpBegin(HTTPClient& http, const String& url) {
  if (url.startsWith("https")) return http.begin(secureClient, url);
  return http.begin(plainClient, url);
}

void postLocation(const char* event) {
  if (strlen(SERVER_URL) == 0 || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  if (!httpBegin(http, SERVER_URL)) return;
  http.setTimeout(3000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  String body = String("{\"deviceId\":\"") + DEVICE_ID +
                "\",\"event\":\"" + event +
                "\",\"lat\":" + String(lastLat, 6) +
                ",\"lng\":" + String(lastLng, 6) +
                ",\"fix\":" + (haveFix ? "true" : "false") + "}";
  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("POST %s -> HTTP %d\n", event, code);
  } else {
    Serial.printf("POST %s failed: %s\n", event, http.errorToString(code).c_str());
  }
  http.end();
  lastPost = millis();
}

// ---------- COMMANDS / SOS ----------
void startSOS() {
  sosActive = true;
  sosStart = millis();
  ledBlink(3);
  postLocation("sos_start");                   // fastest path first
  smsAll("SOS! I need help. This is an emergency.");
  makeCall(CONTACTS[0]);
}

void cancelSOS() {
  sosActive = false;
  ledBlink(1);
  postLocation("sos_cancel");
  smsAll("SOS cancelled. I am safe now.");
}

void runCommand(const String& cmd, const String& replyTo) {
  Serial.println("CMD: " + cmd);
  if (cmd == "SOS")       { if (!sosActive) startSOS(); }
  else if (cmd == "STOP") { if (sosActive) cancelSOS(); }
  else if (cmd == "LOC")  { if (replyTo.length() > 0) sendSMS(replyTo, locationText()); else Serial.println(locationText()); }
}

void pollServerCommand() {
  lastPoll = millis();
  if (strlen(COMMAND_URL) == 0 || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  if (!httpBegin(http, COMMAND_URL)) return;
  http.setTimeout(3000);
  http.addHeader("x-api-key", API_KEY);
  int code = http.GET();
  String payload = (code == 200) ? http.getString() : "";
  if (code > 0) {
    if (payload.length() > 0 && payload.indexOf("\"none\"") < 0) {
      Serial.printf("POLL RECEIVED COMMAND: %s\n", payload.c_str());
    }
  } else {
    Serial.printf("POLL failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();                                  // close connection before any long action
  if (payload.indexOf("\"sos\"") >= 0)       runCommand("SOS", "");
  else if (payload.indexOf("\"stop\"") >= 0) runCommand("STOP", "");
}

// ---------- INCOMING SMS ----------
void handleGsmLine(String line) {
  line.trim();
  if (line.length() == 0) return;
  if (line.startsWith("+CMT:")) {              // +CMT: "+91xxxxxxxxxx","","date"
    int a = line.indexOf('"');
    int b = line.indexOf('"', a + 1);
    smsSender = (a >= 0 && b > a) ? line.substring(a + 1, b) : "";
    expectBody = true;
    return;
  }
  if (expectBody) {                            // next non-empty line is the SMS text
    expectBody = false;
    String cmd = line;
    cmd.toUpperCase();
    Serial.println("SMS from " + smsSender + ": " + cmd);
    if (isAuthorized(smsSender)) runCommand(cmd, smsSender);
    else Serial.println("Ignored: unauthorized sender");
    return;
  }
  if (line == "RING") gsmSerial.print("ATH\r");  // reject incoming calls
}

void readGsm() {
  while (gsmSerial.available()) {
    char c = gsmSerial.read();
    if (c == '\n') { String l = gsmLine; gsmLine = ""; handleGsmLine(l); }
    else if (c != '\r' && gsmLine.length() < 200) gsmLine += c;
  }
}

void readSerialCommands() {                    // bench testing from Serial Monitor
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      String cmd = serialLine; serialLine = "";
      cmd.trim(); cmd.toUpperCase();
      if (cmd.length() > 0) runCommand(cmd, "");
    } else if (c != '\r') serialLine += c;
  }
}

// ---------- MAIN ----------
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);                 // LED off (active LOW)
  secureClient.setInsecure();                  // fine for testing; pin a certificate for production

  gpsSerial.begin(9600);
  gsmSerial.begin(9600);

  if (strlen(WIFI_SSID) > 0) WiFi.begin(WIFI_SSID, WIFI_PASS);   // non-blocking

  if (gsmInit()) {
    Serial.println("GSM ready, waiting for network...");
    for (int i = 0; i < 30; i++) {
      if (networkReady()) { Serial.println("Network registered"); break; }
      waitMs(1000);
    }
    ledBlink(1);
  } else {
    Serial.println("GSM NOT responding - check power/wiring");
    ledBlink(5);
  }
  Serial.println("Type sos / stop / loc here to test.");
}

void loop() {
  feedGPS();
  readGsm();
  readSerialCommands();

  // LED: fast blink = SOS, solid = GPS fix, slow blink = searching
  if (sosActive)                   digitalWrite(LED_PIN, (millis() / 150) % 2);
  else if (gps.location.isValid()) digitalWrite(LED_PIN, LOW);
  else                             digitalWrite(LED_PIN, (millis() / 500) % 2);

  if (millis() - lastPoll >= POLL_MS) pollServerCommand();

  if (sosActive) {
    if (millis() - sosStart > SOS_MAX_MS) { sosActive = false; return; }
    if (millis() - lastPost >= POST_UPDATE_MS) postLocation("sos_update");
    if (millis() - lastSms  >= SMS_UPDATE_MS && haveFix) smsAll("SOS update:");
  }
  yield();
}
