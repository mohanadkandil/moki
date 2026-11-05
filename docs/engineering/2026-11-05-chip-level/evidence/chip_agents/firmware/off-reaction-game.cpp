#include <Arduino.h>
#include "pins.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

extern "C" int64_t esp_timer_get_time(void);
extern "C" uint32_t esp_random(void);

Adafruit_SSD1306 display(128, 64, &Wire, -1);
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
volatile bool buttonHigh = false, capturing = false, pending = false;
volatile int64_t highSince = 0, edgeTime = 0;
bool screenOK = false;
uint8_t address = 0;
int64_t frameEnd = 0, cueTime = 0;
uint32_t waitStart = 0, waitLength = 0, best = 0;
bool haveBest = false;
enum Phase { READY, RELEASE_START, WAITING, REACTION };
Phase phase = READY;

void IRAM_ATTR buttonISR() {
  int64_t now = esp_timer_get_time();
  bool high = digitalRead(PIN_SW1_SW) == HIGH;
  portENTER_CRITICAL_ISR(&mux);
  if (high && !buttonHigh) highSince = now;
  if (!high && buttonHigh && capturing && !pending) {
    edgeTime = now;
    pending = true;
    capturing = false; // First edge wins; subsequent bounce cannot replace it.
  }
  buttonHigh = high;
  portEXIT_CRITICAL_ISR(&mux);
}

bool probe(uint8_t a) {
  Wire.beginTransmission(a);
  return Wire.endTransmission() == 0;
}

bool present() {
  display.display(); // Interrupts remain enabled throughout the OLED transfer.
  frameEnd = esp_timer_get_time();
  if (!probe(address)) {
    screenOK = false;
    Serial.println("OLED communication failed; visual game stopped.");
  }
  return screenOK;
}

void text(const char *title, const char *line = "") {
  Serial.println(title);
  if (*line) Serial.println(line);
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(title);
  display.println();
  display.println(line);
  display.setCursor(0, 46);
  display.println("Approximate timing");
  display.println("OLED / switch latency");
  present();
}

void stopCapture() {
  portENTER_CRITICAL(&mux);
  capturing = false;
  pending = false;
  portEXIT_CRITICAL(&mux);
}

bool armAfterRelease() {
  bool armed = false;
  portENTER_CRITICAL(&mux);
  if (buttonHigh && esp_timer_get_time() - highSince >= 20000) {
    pending = false;
    capturing = true;
    armed = true;
  }
  portEXIT_CRITICAL(&mux);
  return armed;
}

bool takeEdge(int64_t &t) {
  portENTER_CRITICAL(&mux);
  bool found = pending;
  if (found) {
    t = edgeTime;
    pending = false;
  }
  portEXIT_CRITICAL(&mux);
  return found;
}

void result(const char *message) {
  stopCapture();
  phase = READY;
  text(message, "Release, then press");
}

void response(int64_t t) {
  if (t < cueTime) {
    result("Too soon!");
  } else if (t - cueTime > 10000000LL) {
    result("No response");
  } else {
    uint32_t ms = (uint32_t)((t - cueTime + 500) / 1000);
    if (!haveBest || ms < best) { best = ms; haveBest = true; }
    char title[32], detail[64];
    snprintf(title, sizeof(title), "Time: %lu ms", (unsigned long)ms);
    snprintf(detail, sizeof(detail), "Best: %lu ms\nRelease, then press", (unsigned long)best);
    stopCapture();
    phase = READY;
    text(title, detail);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_SW1_SW, INPUT_PULLUP);
  pinMode(PIN_SW1_CLK, INPUT_PULLUP);
  pinMode(PIN_SW1_DT, INPUT_PULLUP); // Rotation deliberately ignored.
  buttonHigh = digitalRead(PIN_SW1_SW) == HIGH;
  highSince = esp_timer_get_time();
  attachInterrupt(digitalPinToInterrupt(PIN_SW1_SW), buttonISR, CHANGE);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setTimeOut(25);
  if (probe(0x3C)) address = 0x3C;
  else if (probe(0x3D)) address = 0x3D;
  if (!address) {
    Serial.println("OLED not found at 0x3C or 0x3D; visual game unavailable.");
    return;
  }
  screenOK = display.begin(SSD1306_SWITCHCAPVCC, address, true, false);
  if (!screenOK) {
    Serial.println("OLED initialization failed; visual game unavailable.");
    return;
  }
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(true);
  Serial.printf("OLED at 0x%02X. Timing is approximate; no persistent storage.\n", address);
  text("Press to start");
}

void loop() {
  if (!screenOK) return;
  int64_t t;
  switch (phase) {
    case READY: {
      // Do not re-arm a first edge that has already been captured.
      portENTER_CRITICAL(&mux);
      bool idle = !capturing && !pending;
      portEXIT_CRITICAL(&mux);
      if (idle) armAfterRelease();
      if (takeEdge(t)) {
        phase = RELEASE_START;
        text("Release button", "Next: wait for GO!");
      }
      break;
    }
    case RELEASE_START: {
      // Rejection sampling gives exactly uniform inclusive 2000..5000 ms.
      // A rejected draw is retried on the next loop, never in a busy loop.
      uint32_t r = esp_random();
      if (r < (-uint32_t(3001)) % 3001) return;
      if (armAfterRelease()) {
        waitLength = 2000 + r % 3001;
        waitStart = millis();
        phase = WAITING;
        text("Wait...");
      }
      break;
    }
    case WAITING:
      if (takeEdge(t)) {
        result("Too soon!");
      } else if ((uint32_t)(millis() - waitStart) >= waitLength) {
        display.clearDisplay();
        display.setTextSize(4);
        display.setCursor(28, 16);
        display.print("GO!");
        if (!present()) return;
        cueTime = frameEnd; // Immediately after the complete cue transfer.
        phase = REACTION;
        // Includes edges captured during the cue transfer, not debounced ones.
        if (takeEdge(t)) response(t);
      }
      break;
    case REACTION:
      if (takeEdge(t)) {
        response(t);
      } else if (esp_timer_get_time() - cueTime >= 10000000LL) {
        // Recheck under the same lock used by the ISR before declaring timeout.
        portENTER_CRITICAL(&mux);
        bool found = pending;
        if (found) { t = edgeTime; pending = false; }
        capturing = false;
        portEXIT_CRITICAL(&mux);
        if (found) response(t);
        else result("No response");
      }
      break;
  }
}
