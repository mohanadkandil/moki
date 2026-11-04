// Deterministic Moki light-lamp firmware. USB power, 3.3 V logic.
#include <Arduino.h>
#include <math.h>
#include "pins.h"

void setupBuzzer() {}
void startChime(uint32_t) {}
void stopChime() {}
void updateChime(uint32_t) {}

constexpr float DARK_PERCENT = 30;
constexpr float LIGHT_PERCENT = 35; // 5 percentage point hysteresis
constexpr uint8_t LED_CHANNEL = 0;
bool lampOn = false;
bool sampled = false;
float brightness = 0;
uint32_t lastSample = 0, lastReport = 0;
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LIGHT_SENSE, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_LIGHT_SENSE, ADC_11db);
  ledcSetup(LED_CHANNEL, 5000, 8);
  ledcAttachPin(PIN_LED, LED_CHANNEL);
  ledcWrite(LED_CHANNEL, 0);
}
void loop() {
  uint32_t now = millis();
  if (now - lastSample < 20) { delay(1); return; }
  lastSample = now;
  float reading = analogRead(PIN_LIGHT_SENSE) * (100.0f / 4095.0f);
  brightness = sampled ? brightness * 0.8f + reading * 0.2f : reading;
  sampled = true;
  // More light raises the catalog divider voltage. Keep state inside the dead band.
  if (!lampOn && brightness < DARK_PERCENT) lampOn = true;
  if (lampOn && brightness >= LIGHT_PERCENT) lampOn = false;
  uint32_t duty = lampOn ? uint32_t(constrain(255.0f * (1.0f - brightness / 100.0f), 32.0f, 255.0f)) : 0;
  ledcWrite(LED_CHANNEL, duty);
  if (now - lastReport >= 1000) {
    lastReport = now;
    Serial.printf("Light %.1f%%, PWM %lu/255\n", brightness, (unsigned long)duty);
  }
}
