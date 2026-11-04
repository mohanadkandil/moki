
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
constexpr int PIN_LED = 25;
constexpr int PIN_LIGHT_SENSE = 34;
// Deterministic Moki light-lamp firmware. USB power, 3.3 V logic.




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

int main() {
 setup();
 auto sample=[](int adc) {fakeADC=adc;for(int i=0;i<50;i++){fakeNow+=20;loop();}};
 sample(1000);assert(lampOn && fakeDuty[LED_CHANNEL]>0);
 sample(1310);assert(lampOn); // 32%, inside the 30..35 hysteresis dead band
 sample(1800);assert(!lampOn && fakeDuty[LED_CHANNEL]==0);
 sample(1310);assert(!lampOn); // dead band retains the off state too
 sample(0);assert(lampOn && fakeDuty[LED_CHANNEL]>=254); // filtered reading approaches zero
 return 0;
}