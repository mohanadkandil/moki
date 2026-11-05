#include <Arduino.h>
#include "pins.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_BME280.h>
#include <math.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1, 100000, 100000);
Adafruit_BME280 bme;
bool screenOK = false, sensorOK = false;
uint8_t sensorAddress = 0;
unsigned long lastSample = 0;
enum { READING, VALID, ERROR } state = READING;
float humidity = 0;

bool present(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void draw() {
  if (!screenOK) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(40, 0);
  display.print("Humidity");
  if (state == READING) {
    display.setTextSize(2);
    display.setCursor(4, 26);
    display.print("Reading...");
  } else {
    String number = state == VALID ? String((int)(humidity + 0.5f)) : String("--");
    int width = number.length() * 18 + 54;
    int x = (128 - width) / 2;
    display.setTextSize(3);
    display.setCursor(x, 24);
    display.print(number);
    display.setTextSize(2);
    display.setCursor(x + number.length() * 18 + 6, 31);
    display.print("% RH");
    if (state == ERROR) {
      display.setTextSize(1);
      display.setCursor(28, 54);
      display.print("Sensor error");
    }
  }
  display.display();
}

void initScreen() {
  uint8_t address = present(0x3C) ? 0x3C : (present(0x3D) ? 0x3D : 0);
  screenOK = address && display.begin(SSD1306_SWITCHCAPVCC, address, true, false);
  if (screenOK) {
    display.setTextWrap(false);
    Serial.printf("OLED detected at 0x%02X\n", address);
    draw();
  } else Serial.println("OLED error: missing or initialization failed");
}

void initSensor() {
  sensorOK = false;
  for (uint8_t address = 0x76; address <= 0x77; ++address) {
    if (present(address) && bme.begin(address, &Wire)) {
      sensorAddress = address;
      sensorOK = true;
      Serial.printf("BME280 detected at 0x%02X\n", address);
      break;
    }
  }
  if (!sensorOK) {
    state = ERROR;
    Serial.println("Sensor error: BME280 initialization failed");
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000);
  Wire.setTimeOut(50);
  initScreen();
  Serial.println("Reading...");
  initSensor();
  draw();
  lastSample = millis();
}

void loop() {
  unsigned long now = millis();
  if (now - lastSample < 2000) return;
  lastSample = now;
  if (!screenOK) initScreen();
  if (!sensorOK) {
    initSensor();
    // Allow the newly initialized sensor a full measurement interval.
    draw();
    return;
  }
  float value = present(sensorAddress) ? bme.readHumidity() : NAN;
  if (!present(sensorAddress) || !isfinite(value) || value < 0 || value > 100) {
    sensorOK = false;
    state = ERROR;
    Serial.println("Sensor error: humidity reading failed");
  } else {
    humidity = value;
    state = VALID;
    Serial.printf("Humidity: %.1f %% RH\n", humidity);
  }
  draw();
}
