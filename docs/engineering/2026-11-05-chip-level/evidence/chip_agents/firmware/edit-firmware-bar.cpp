#include <Arduino.h>
#include "pins.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <stdio.h>
#include <string.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);
bool displayReady = false;
uint32_t configuredMinutes = 25, remainingMs = 25 * 60000UL;
uint32_t sessionMs = 25 * 60000UL;
bool running = false, sessionStarted = false;
uint32_t lastTick = 0, lastReport = 0, switchChangedAt = 0;
uint8_t encoderPrevious = 0;
int8_t encoderSteps = 0;
bool switchRaw = HIGH, switchStable = HIGH;

void screen(const char* clock) {
  if (!displayReady) return;
  // Keep the session's original duration through every pause/resume.
  int progress = sessionStarted ? (uint64_t)(sessionMs - remainingMs) * 124 / sessionMs : 0;
  const char* detail = running ? "Press to pause" : remainingMs == 0 ? "Done - press restart" : "Turn mins / Press go";
  static char lastClock[16] = "";
  static int lastProgress = -1, lastState = -1;
  int state = running ? 1 : remainingMs == 0 ? 2 : 0;
  if (!strcmp(clock, lastClock) && progress == lastProgress && state == lastState) return;
  snprintf(lastClock, sizeof(lastClock), "%s", clock);
  lastProgress = progress;
  lastState = state;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1); display.setCursor(0, 0); display.println("FOCUS TIMER");
  display.setTextSize(2); display.setCursor(0, 20); display.println(clock);
  display.drawRect(0, 41, 128, 8, SSD1306_WHITE);
  if (progress) display.fillRect(2, 43, progress, 4, SSD1306_WHITE);
  display.setTextSize(1); display.setCursor(0, 52); display.println(detail);
  display.display();
}

void setup() {
  Serial.begin(115200);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.beginTransmission(0x3C);
  bool oledPresent = Wire.endTransmission() == 0;
  displayReady = oledPresent && display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!displayReady) Serial.println("OLED unavailable or init failed; using serial output");
  Serial.println("Focus timer: turn to set minutes, press to start/pause");
  pinMode(PIN_SW1_CLK, INPUT_PULLUP);
  pinMode(PIN_SW1_DT, INPUT_PULLUP);
  pinMode(PIN_SW1_SW, INPUT_PULLUP);
  encoderPrevious = (digitalRead(PIN_SW1_CLK) << 1) | digitalRead(PIN_SW1_DT);
  lastTick = millis();
}

void loop() {
  uint32_t now = millis();
  uint32_t elapsed = now - lastTick;
  lastTick = now;
  if (running) {
    if (elapsed >= remainingMs) {
      remainingMs = 0;
      running = false;
      Serial.println("Session complete");
    } else remainingMs -= elapsed;
  }
  static const int8_t transitions[] = {0,-1,1,0, 1,0,0,-1, -1,0,0,1, 0,1,-1,0};
  uint8_t current = (digitalRead(PIN_SW1_CLK) << 1) | digitalRead(PIN_SW1_DT);
  encoderSteps += transitions[(encoderPrevious << 2) | current];
  encoderPrevious = current;
  if (encoderSteps >= 4 || encoderSteps <= -4) {
    if (!running) {
      int next = int(configuredMinutes) + (encoderSteps > 0 ? 1 : -1);
      configuredMinutes = constrain(next, 1, 180);
      remainingMs = configuredMinutes * 60000UL;
      sessionMs = remainingMs;
      sessionStarted = false;
    }
    encoderSteps = 0;
  }
  bool raw = digitalRead(PIN_SW1_SW);
  if (raw != switchRaw) { switchRaw = raw; switchChangedAt = now; }
  if (raw != switchStable && now - switchChangedAt >= 30) {
    switchStable = raw;
    if (switchStable == LOW) {
      if (remainingMs == 0) {
        remainingMs = configuredMinutes * 60000UL;
        sessionStarted = false;
      }
      if (!sessionStarted) {
        sessionMs = remainingMs;
        sessionStarted = true;
      }
      running = !running;
      Serial.println(running ? "Running" : "Paused");
    }
  }
  uint32_t seconds = (remainingMs + 999) / 1000;
  char clock[16];
  snprintf(clock, sizeof(clock), "%02lu:%02lu", (unsigned long)(seconds / 60), (unsigned long)(seconds % 60));
  screen(clock);
  if (now - lastReport >= 1000) {
    lastReport = now;
    Serial.println(clock);
  }
}
