#include <Arduino.h>
#include "pins.h"

const uint8_t duties[] = {0, 102, 179, 255};
const uint8_t speeds[] = {0, 40, 70, 100};
uint8_t stage = 0;
bool rawPressed = false, stablePressed = false, armed = false;
unsigned long changedAt = 0;

void setup() {
  digitalWrite(PIN_DRIVER_IN1, LOW);
  digitalWrite(PIN_DRIVER_IN2, LOW);
  pinMode(PIN_DRIVER_IN1, OUTPUT);
  pinMode(PIN_DRIVER_IN2, OUTPUT);
  delay(2);  // Driver wake time; motor remains coasting.
  pinMode(PIN_BUTTON_BUTTON, INPUT_PULLUP);
  rawPressed = stablePressed = (digitalRead(PIN_BUTTON_BUTTON) == LOW);
  armed = !stablePressed;
  changedAt = millis();
  Serial.begin(115200);
  Serial.println("Stopped/coast. Using core-default PWM; listed API has no 20 kHz frequency control.");
}

void loop() {
  unsigned long now = millis();
  bool pressed = (digitalRead(PIN_BUTTON_BUTTON) == LOW);
  if (pressed != rawPressed) {
    rawPressed = pressed;
    changedAt = now;
  }
  if (rawPressed != stablePressed && now - changedAt >= 30) {
    stablePressed = rawPressed;
    if (!stablePressed) {
      armed = true;
    } else if (armed) {
      armed = false;
      stage = (stage + 1) % 4;
      digitalWrite(PIN_DRIVER_IN2, LOW);
      analogWrite(PIN_DRIVER_IN1, duties[stage]);
      Serial.print("Motor PWM: ");
      Serial.print(speeds[stage]);
      Serial.println(stage == 0 ? "% (coast)" : "% forward");
    }
  }
}
