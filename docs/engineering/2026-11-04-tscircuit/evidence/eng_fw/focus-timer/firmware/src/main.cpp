// Deterministic Moki focus-timer firmware. USB power, 3.3 V logic.
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

constexpr uint32_t INITIAL_MINUTES = 25;
uint32_t configuredMinutes = INITIAL_MINUTES;
uint32_t remainingMs = INITIAL_MINUTES * 60000UL;
bool running = false;
uint32_t lastTick = 0, lastFrame = 0, switchChangedAt = 0;
uint8_t encoderPrevious = 0;
int8_t encoderSteps = 0;
bool switchRaw = HIGH, switchStable = HIGH;
void setup() {
  Serial.begin(115200);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  setupDisplay(); setupBuzzer();
  pinMode(PIN_ENCODER_A, INPUT_PULLUP);
  pinMode(PIN_ENCODER_B, INPUT_PULLUP);
  pinMode(PIN_ENCODER_SW, INPUT_PULLUP);
  encoderPrevious = (digitalRead(PIN_ENCODER_A) << 1) | digitalRead(PIN_ENCODER_B);
  lastTick = millis();
}
void loop() {
  uint32_t now = millis();
  uint32_t elapsed = now - lastTick;
  lastTick = now;
  if (running) {
    if (elapsed >= remainingMs) {
      remainingMs = 0; running = false; startChime(now);
    } else remainingMs -= elapsed;
  }
  // Decode all four quadrature transitions; rejected bounce cancels itself.
  static const int8_t transitions[] = {0,-1,1,0, 1,0,0,-1, -1,0,0,1, 0,1,-1,0};
  uint8_t current = (digitalRead(PIN_ENCODER_A) << 1) | digitalRead(PIN_ENCODER_B);
  encoderSteps += transitions[(encoderPrevious << 2) | current];
  encoderPrevious = current;
  if (encoderSteps >= 4 || encoderSteps <= -4) {
    if (!running) {
      int next = int(configuredMinutes) + (encoderSteps > 0 ? 1 : -1);
      configuredMinutes = constrain(next, 1, 180);
      remainingMs = configuredMinutes * 60000UL;
      stopChime();
    }
    encoderSteps = 0;
  }
  bool raw = digitalRead(PIN_ENCODER_SW);
  if (raw != switchRaw) { switchRaw = raw; switchChangedAt = now; }
  if (raw != switchStable && now - switchChangedAt >= 30) {
    switchStable = raw;
    if (switchStable == LOW) {
      if (remainingMs == 0) remainingMs = configuredMinutes * 60000UL;
      running = !running; stopChime();
    }
  }
  updateChime(now);
  if (now - lastFrame >= 100) {
    lastFrame = now;
    uint32_t seconds = (remainingMs + 999) / 1000;
    char clock[16]; snprintf(clock, sizeof(clock), "%02lu:%02lu", (unsigned long)(seconds / 60), (unsigned long)(seconds % 60));
    screen("FOCUS TIMER", clock, running ? "Press to pause" : remainingMs == 0 ? "Done - press to restart" : "Turn: minutes / Press: go");
    // A serial fallback also works when no OLED responds.
    if (now % 1000 < 100) Serial.println(clock);
  }
  delay(1);
}
