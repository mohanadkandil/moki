#include <Arduino.h>
#include "pins.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);
bool screenOK = false;
bool rawPressed = false, pressed = false;
uint32_t changedAt = 0, waitAt = 0, waitFor = 0, goAt = 0;
uint8_t state = 0; // Waiting, timing, result

void show(const char *text, const char *hint) {
  Serial.println(text);
  Serial.println(hint);
  if (!screenOK) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 8);
  display.println(text);
  display.setTextSize(1);
  display.setCursor(0, 48);
  display.println(hint);
  display.display();
}

void startRound() {
  state = 0;
  show("Wait...", "Press only after GO");
  waitFor = random(2000, 6001);
  waitAt = millis();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_SW1_SW, INPUT_PULLUP);
  pinMode(PIN_SW1_CLK, INPUT_PULLUP);
  pinMode(PIN_SW1_DT, INPUT_PULLUP);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.beginTransmission(0x3C);
  bool found = Wire.endTransmission() == 0;
  screenOK = found && display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!screenOK) Serial.println("Screen unavailable; using Serial.");
  Serial.println("No buzzer fitted. Reaction timer ready.");
  randomSeed(micros());
  rawPressed = pressed = digitalRead(PIN_SW1_SW) == LOW;
  changedAt = millis();
  startRound();
}

void loop() {
  uint32_t now = millis();
  bool reading = digitalRead(PIN_SW1_SW) == LOW;
  if (reading != rawPressed) {
    rawPressed = reading;
    changedAt = now;
  }
  bool pushed = false;
  if (rawPressed != pressed && uint32_t(now - changedAt) >= 30) {
    pressed = rawPressed;
    pushed = pressed;
  }
  if (pushed) {
    if (state == 2) {
      startRound();
      return;
    }
    if (state == 0) {
      state = 2;
      show("Too soon!", "Release, press to retry");
    } else {
      char text[24];
      snprintf(text, sizeof(text), "%lu ms", (unsigned long)(changedAt - goAt));
      state = 2;
      show(text, "Press to try again");
    }
  }
  if (state == 0 && uint32_t(now - waitAt) >= waitFor) {
    if (rawPressed || pressed) {
      state = 2;
      show("Too soon!", "Release, press to retry");
    } else {
      show("GO", "Press the knob!");
      goAt = millis();
      state = 1;
    }
  }
}
