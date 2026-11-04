// Deterministic Moki temp-monitor firmware. USB power, 3.3 V logic.
#include <Arduino.h>
#include <math.h>
#include "pins.h"

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
Adafruit_SSD1306 display(128, 64, &Wire, -1);
bool displayReady = false;
void setupDisplay() {
  displayReady = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!displayReady) Serial.println("OLED init failed; using serial output");
}
void screen(const char* title, const char* value, const char* detail) {
  if (!displayReady) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1); display.setCursor(0, 0); display.println(title);
  display.setTextSize(2); display.setCursor(0, 20); display.println(value);
  display.setTextSize(1); display.setCursor(0, 52); display.println(detail);
  display.display();
}

constexpr uint8_t BUZZER_CHANNEL = 3;
bool chiming = false;
uint32_t chimeStarted = 0;
void setupBuzzer() {
  ledcSetup(BUZZER_CHANNEL, 2000, 8);
  ledcAttachPin(PIN_BUZZER, BUZZER_CHANNEL);
  ledcWrite(BUZZER_CHANNEL, 0);
}
void startChime(uint32_t now) { chiming = true; chimeStarted = now; }
void stopChime() { chiming = false; ledcWriteTone(BUZZER_CHANNEL, 0); }
void updateChime(uint32_t now) {
  if (!chiming) return;
  uint32_t elapsed = now - chimeStarted;
  if (elapsed >= 600) { stopChime(); return; }
  static const uint16_t notes[] = {1568, 1976, 2093};
  ledcWriteTone(BUZZER_CHANNEL, elapsed % 200 < 120 ? notes[elapsed / 200] : 0);
}

#include <OneWire.h>
#include <DallasTemperature.h>
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature sensor(&oneWire);

constexpr float ALERT_C = 28;
constexpr bool ALERT_BELOW = false;
constexpr bool ALERT_ENABLED = true;
bool sensorReady = false, alertActive = false;
uint32_t lastReading = 0, lastAlert = 0;
void setup() {
  Serial.begin(115200);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  setupDisplay();
  setupBuzzer();

  sensor.begin();
  sensorReady = sensor.getDeviceCount() > 0;
  sensor.setResolution(12);
  sensor.setWaitForConversion(false);
  sensor.requestTemperatures();

  if (!sensorReady) Serial.println("Temperature sensor not found; check wiring/address");
}
void loop() {
  uint32_t now = millis();
  updateChime(now);
  if (now - lastReading < 1000) { delay(1); return; }
  lastReading = now;
  float celsius = sensorReady ? sensor.getTempCByIndex(0) : NAN;
  bool valid = sensorReady && isfinite(celsius) && celsius >= -55 && celsius <= 125;
  if (sensorReady) sensor.requestTemperatures(); // conversion completes before next 1 s sample
  if (!valid) {
    alertActive = false; stopChime();
    Serial.println("Sensor error (no valid temperature)");
    screen("TEMPERATURE", "--", "Sensor / wiring error");
    return;
  }
  bool wasAlert = alertActive;
  if (!ALERT_ENABLED) alertActive = false;
  else if (!alertActive) alertActive = ALERT_BELOW ? celsius < ALERT_C : celsius > ALERT_C;
  else if (ALERT_BELOW ? celsius >= ALERT_C + 0.5f : celsius <= ALERT_C - 0.5f) alertActive = false;
  if (alertActive && (!wasAlert || now - lastAlert >= 10000)) {
    startChime(now); lastAlert = now;
  }
  if (!alertActive) stopChime();
  char value[24]; snprintf(value, sizeof(value), "%.1f C", celsius);
  Serial.printf("Temperature %s%s\n", value, alertActive ? " ALERT" : "");
  screen("TEMPERATURE", value, alertActive ? "ALERT: threshold crossed" : "Monitoring");
}
