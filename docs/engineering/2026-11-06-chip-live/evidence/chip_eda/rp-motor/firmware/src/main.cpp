#include <Arduino.h>
#include "pins.h"
void setup() {
  digitalWrite(PIN_MOTOR_IN1, LOW);
  digitalWrite(PIN_MOTOR_IN2, LOW);
  pinMode(PIN_MOTOR_IN1, OUTPUT);
  pinMode(PIN_MOTOR_IN2, OUTPUT);
  delay(2);
  analogWrite(PIN_MOTOR_IN1, 0);
  analogWrite(PIN_MOTOR_IN2, 0);
}
void loop() { delay(20); }
