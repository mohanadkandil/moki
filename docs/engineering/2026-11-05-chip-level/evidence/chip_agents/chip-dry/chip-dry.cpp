#ifdef ARDUINO_USB_MODE
#undef ARDUINO_USB_MODE
#endif
#define ARDUINO_USB_MODE 1
#ifdef ARDUINO_USB_CDC_ON_BOOT
#undef ARDUINO_USB_CDC_ON_BOOT
#endif
#define ARDUINO_USB_CDC_ON_BOOT 1
#include <Arduino.h>
#include <Wire.h>
#include "pins.h"

bool busReady = false, scanning = false, hostWasConnected = false;
uint8_t address = 0x08;
unsigned found = 0, errors = 0;
uint32_t nextProbe = 0;
char command[16];
uint8_t commandLength = 0;
bool overflow = false;

void help() {
  Serial.println("ESP32-S3 sensor-board bring-up; command: scan");
  Serial.println("Native USB CDC: GPIO19 D-, GPIO20 D+; no host wait.");
  Serial.println("Sensor connector: 1 GND, 2 VCC (3.3 V), 3 SDA (GPIO8), 4 SCL (GPIO9).");
  Serial.println("External sensor limit: 3.3 V / 50 mA maximum. I2C: 100 kHz, timeout 25 ms.");
  Serial.println("BOOT GPIO0 and EN RESET are hardware controls, not application buttons.");
  Serial.println("Wi-Fi and Bluetooth are not started. No LEDs, charger or battery.");
  if (!busReady) Serial.println("ERROR: I2C initialization failed.");
}

void startScan() {
  if (!busReady) {
    Serial.println("ERROR: cannot scan; I2C initialization failed.");
    return;
  }
  if (scanning) {
    Serial.println("Scan already in progress.");
    return;
  }
  address = 0x08;
  found = errors = 0;
  nextProbe = millis();
  scanning = true;
  Serial.println("Scanning I2C 0x08 through 0x77...");
}

void setup() {
  // Radios remain disabled: neither Wi-Fi nor Bluetooth is initialized.
  Serial.begin(115200);
  busReady = Wire.begin(PIN_SENSOR_I2C_SDA, PIN_SENSOR_I2C_SCL, 100000);
  Wire.setTimeOut(25);
  help();
  startScan();
}

void loop() {
  bool connected = bool(Serial);
  if (connected && !hostWasConnected) help();
  hostWasConnected = connected;

  // Bound serial work so an input stream cannot starve the scan.
  for (unsigned n = 0; n < 32 && Serial.available(); ++n) {
    char c = Serial.read();
    if (c == '\r' || c == '\n') {
      if (commandLength || overflow) {
        command[commandLength] = '\0';
        if (!overflow && strcmp(command, "scan") == 0) startScan();
        else Serial.println("Unknown command; enter scan.");
      }
      commandLength = 0;
      overflow = false;
    } else if (commandLength < sizeof(command) - 1) {
      command[commandLength++] = c;
    } else overflow = true;
  }

  uint32_t now = millis();
  if (scanning && (int32_t)(now - nextProbe) >= 0) {
    // Address-only probe: no sensor configuration registers are written.
    Wire.beginTransmission(address);
    uint8_t result = Wire.endTransmission();
    if (result == 0) {
      Serial.printf("Responding: 0x%02X\n", address);
      ++found;
    } else if (result != 2) {
      Serial.printf("I2C error at 0x%02X: code %u (5 = timeout)\n", address, result);
      ++errors;
    }
    if (address == 0x77) {
      scanning = false;
      if (!found) Serial.println("No responding I2C devices found.");
      Serial.printf("Scan complete: %u responding, %u bus errors.\n", found, errors);
    } else {
      ++address;
      nextProbe = millis() + 2;
    }
  }
  yield();
}
