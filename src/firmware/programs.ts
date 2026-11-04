/** Reviewed Arduino core 2.x drivers. All physical pins live in generated pins.h. */
export const DISPLAY = `
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
  static char lastTitle[32] = "", lastValue[32] = "", lastDetail[32] = "";
  if (strcmp(title, lastTitle) == 0 && strcmp(value, lastValue) == 0 && strcmp(detail, lastDetail) == 0) return;
  snprintf(lastTitle, sizeof(lastTitle), "%s", title);
  snprintf(lastValue, sizeof(lastValue), "%s", value);
  snprintf(lastDetail, sizeof(lastDetail), "%s", detail);
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1); display.setCursor(0, 0); display.println(title);
  display.setTextSize(2); display.setCursor(0, 20); display.println(value);
  display.setTextSize(1); display.setCursor(0, 52); display.println(detail);
  display.display();
}
`;

export const CHIME = `
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
`;

export const SILENT = `
void setupBuzzer() {}
void startChime(uint32_t) {}
void stopChime() {}
void updateChime(uint32_t) {}
`;

export function timerProgram(minutes: number): string {
  return `
constexpr uint32_t INITIAL_MINUTES = ${minutes};
uint32_t configuredMinutes = INITIAL_MINUTES;
uint32_t remainingMs = INITIAL_MINUTES * 60000UL;
bool running = false;
uint32_t lastTick = 0, lastReport = 0, switchChangedAt = 0;
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
  {
    uint32_t seconds = (remainingMs + 999) / 1000;
    char clock[16]; snprintf(clock, sizeof(clock), "%02lu:%02lu", (unsigned long)(seconds / 60), (unsigned long)(seconds % 60));
    screen("FOCUS TIMER", clock, running ? "Press to pause" : remainingMs == 0 ? "Done - press restart" : "Turn mins / Press go");
    // A serial fallback also works when no OLED responds.
    if (now - lastReport >= 1000) { lastReport = now; Serial.println(clock); }
  }
  delay(1);
}
`;
}

export function lampProgram(threshold: number): string {
  return `
constexpr float DARK_PERCENT = ${threshold};
constexpr float LIGHT_PERCENT = ${Math.min(100, threshold + 5)}; // 5 percentage point hysteresis
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
    Serial.printf("Light %.1f%%, PWM %lu/255\\n", brightness, (unsigned long)duty);
  }
}
`;
}

export function temperatureProgram(sensor: 'bme280' | 'ds18b20', display: boolean, threshold: number, below: boolean, enabled: boolean): string {
  const declarations = sensor === 'bme280' ? `
#include <Adafruit_BME280.h>
Adafruit_BME280 sensor;
` : `
#include <OneWire.h>
#include <DallasTemperature.h>
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature sensor(&oneWire);
`;
  const setup = sensor === 'bme280' ? `
  sensorReady = sensor.begin(0x76, &Wire) || sensor.begin(0x77, &Wire);
` : `
  sensor.begin();
  sensorReady = sensor.getDeviceCount() > 0;
  sensor.setResolution(12);
  sensor.setWaitForConversion(false);
  sensor.requestTemperatures();
`;
  const read = sensor === 'bme280' ? 'sensor.readTemperature()' : 'sensor.getTempCByIndex(0)';
  return declarations + `
constexpr float ALERT_C = ${threshold};
constexpr bool ALERT_BELOW = ${below};
constexpr bool ALERT_ENABLED = ${enabled};
bool sensorReady = false, alertActive = false;
uint32_t lastReading = 0, lastAlert = 0;
void setup() {
  Serial.begin(115200);
${sensor === 'bme280' || display ? '  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);' : ''}
${display ? '  setupDisplay();' : ''}
  setupBuzzer();
${setup}
  if (!sensorReady) Serial.println("Temperature sensor not found; check wiring/address");
}
void loop() {
  uint32_t now = millis();
  updateChime(now);
  if (now - lastReading < 1000) { delay(1); return; }
  lastReading = now;
  float celsius = sensorReady ? ${read} : NAN;
  bool valid = sensorReady && isfinite(celsius) && celsius >= ${sensor === 'bme280' ? '-40' : '-55'} && celsius <= ${sensor === 'bme280' ? '85' : '125'};
${sensor === 'ds18b20' ? '  if (sensorReady) sensor.requestTemperatures(); // conversion completes before next 1 s sample' : ''}
  if (!valid) {
    alertActive = false; stopChime();
    Serial.println("Sensor error (no valid temperature)");
${display ? '    screen("TEMPERATURE", "--", "Sensor / wiring error");' : ''}
    return;
  }
  bool wasAlert = alertActive;
  if (!ALERT_ENABLED) alertActive = false;
  else if (!alertActive) alertActive = ALERT_BELOW ? celsius < ALERT_C : celsius > ALERT_C;
  else if (ALERT_BELOW ? celsius >= ALERT_C + 0.5f : celsius <= ALERT_C - 0.5f) alertActive = false;
  if (alertActive && (!wasAlert || now - lastAlert >= 10000)) {
    startChime(now); lastAlert = now;
  }
  if (!alertActive) stopChime();
  char value[24]; snprintf(value, sizeof(value), "%.1f C", celsius);
  Serial.printf("Temperature %s%s\\n", value, alertActive ? " ALERT" : "");
${display ? '  screen("TEMPERATURE", value, alertActive ? "ALERT: limit crossed" : "Monitoring");' : ''}
}
`;
}
