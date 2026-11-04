
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
using std::isfinite;
#define HIGH 1
#define LOW 0
#define INPUT 0
#define INPUT_PULLUP 2
#define ADC_11db 3
#define SSD1306_SWITCHCAPVCC 2
#define SSD1306_WHITE 1
#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))
uint32_t fakeNow=0;
int fakePins[40]={};
int fakeADC=0;
uint32_t fakeDuty[16]={};
uint32_t fakeTone[16]={};
float fakeTemperature=25;
std::string fakeScreen;
uint32_t millis() {return fakeNow;}
void delay(int) {}
void pinMode(int pin,int mode) {if(mode==INPUT_PULLUP) fakePins[pin]=HIGH;}
int digitalRead(int pin) {return fakePins[pin];}
int analogRead(int) {return fakeADC;}
void analogReadResolution(int) {}
void analogSetPinAttenuation(int,int) {}
void ledcSetup(int,int,int) {}
void ledcAttachPin(int,int) {}
void ledcWrite(int channel,uint32_t duty) {fakeDuty[channel]=duty;}
void ledcWriteTone(int channel,uint32_t hz) {fakeTone[channel]=hz;}
struct SerialMock {
 void begin(int) {}
 void println(const char*) {}
 template<class... T> void printf(const char*,T...) {}
} Serial;
struct WireMock {void begin(int,int) {}} Wire;
struct Adafruit_SSD1306 {
 int size=1;
 Adafruit_SSD1306(int,int,WireMock*,int) {}
 bool begin(int,int) {return true;}
 void clearDisplay() {}
 void setTextColor(int) {}
 void setTextSize(int s) {size=s;}
 void setCursor(int,int) {}
 void println(const char* s) {if(size==2) fakeScreen=s;}
 void display() {}
};
struct Adafruit_BME280 {bool begin(int,WireMock*) {return true;} float readTemperature() {return fakeTemperature;}};
struct OneWire {OneWire(int) {}};
struct DallasTemperature {
 DallasTemperature(OneWire*) {}
 void begin() {}
 int getDeviceCount() {return 1;}
 void setResolution(int) {}
 void setWaitForConversion(bool) {}
 void requestTemperatures() {}
 float getTempCByIndex(int) {return fakeTemperature;}
};

// Generated solely from the CircuitDesign nets and catalog GPIO metadata.
constexpr int PIN_BUZZER = 23;
constexpr int PIN_I2C_SCL = 22;
constexpr int PIN_I2C_SDA = 21;
// Deterministic Moki temp-monitor firmware. USB power, 3.3 V logic.







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


Adafruit_BME280 sensor;

constexpr float ALERT_C = 28;
constexpr bool ALERT_BELOW = false;
constexpr bool ALERT_ENABLED = true;
bool sensorReady = false, alertActive = false;
uint32_t lastReading = 0, lastAlert = 0;
void setup() {
  Serial.begin(115200);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  setupDisplay();
  setupBuzzer();

  sensorReady = sensor.begin(0x76, &Wire) || sensor.begin(0x77, &Wire);

  if (!sensorReady) Serial.println("Temperature sensor not found; check wiring/address");
}
void loop() {
  uint32_t now = millis();
  updateChime(now);
  if (now - lastReading < 1000) { delay(1); return; }
  lastReading = now;
  float celsius = sensorReady ? sensor.readTemperature() : NAN;
  bool valid = sensorReady && isfinite(celsius) && celsius >= -40 && celsius <= 85;

  if (!valid) {
    alertActive = false; stopChime();
    Serial.println("Sensor error (no valid temperature)");
    screen("TEMPERATURE", "--", "Sensor / wiring error");
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
  Serial.printf("Temperature %s%s\n", value, alertActive ? " ALERT" : "");
  screen("TEMPERATURE", value, alertActive ? "ALERT: threshold crossed" : "Monitoring");
}

int main() {
 setup();
 auto sample=[](float temperature) {fakeTemperature=temperature;fakeNow+=1000;loop();};
 sample(25);assert(!alertActive && fakeScreen=="25.0 C");
 sample(29);assert(alertActive && chiming);
 sample(27.8f);assert(alertActive); // retain within 0.5 C hysteresis
 sample(27.0f);assert(!alertActive && !chiming);
 sample(30);assert(alertActive);
 sample(NAN);assert(!alertActive && !chiming && fakeScreen=="--");
 return 0;
}