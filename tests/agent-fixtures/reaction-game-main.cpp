// The reaction-time game, written by hand so an offline replay can compile it. Not a model's firmware.
#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "pins.h"

Adafruit_SSD1306 display(128, 64, &Wire, -1);
enum State { WAITING, LIT, SHOWING };
State state = WAITING;
unsigned long litAt = 0, shownAt = 0;
long best = -1;

static bool pressed() {
  static bool last = true;
  static unsigned long changed = 0;
  bool now = digitalRead(PIN_SW1_SW);
  if (now != last && millis() - changed > 30) { changed = millis(); last = now; return !now; }
  return false;
}

static void show(long ms) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.setTextSize(2);
  if (ms >= 0) { display.print(ms); display.println(" ms"); } else display.println("Wait...");
  display.setTextSize(1);
  display.print("Best: ");
  if (best >= 0) { display.print(best); display.println(" ms"); } else display.println("--");
  display.display();
}

static void nextRound() {
  digitalWrite(PIN_D1_A, LOW);
  litAt = millis() + 1500 + random(3500);
  state = WAITING;
  show(-1);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_SW1_SW, INPUT_PULLUP);
  pinMode(PIN_D1_A, OUTPUT);
  ledcSetup(3, 2000, 8);
  ledcAttachPin(PIN_BZ1_POS, 3);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("No screen");
  randomSeed(micros());
  nextRound();
}

void loop() {
  bool press = pressed();
  if (state == WAITING) {
    if (press) { ledcWriteTone(3, 2000); delay(150); ledcWriteTone(3, 0); nextRound(); }
    else if ((long)(millis() - litAt) >= 0) { digitalWrite(PIN_D1_A, HIGH); litAt = millis(); state = LIT; }
  } else if (state == LIT) {
    if (press) {
      long ms = millis() - litAt;
      if (best < 0 || ms < best) best = ms;
      digitalWrite(PIN_D1_A, LOW);
      show(ms);
      shownAt = millis();
      state = SHOWING;
    }
  } else if (press || millis() - shownAt > 4000) nextRound();
}
