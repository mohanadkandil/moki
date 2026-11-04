
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
constexpr int PIN_ENCODER_A = 32;
constexpr int PIN_ENCODER_B = 33;
constexpr int PIN_ENCODER_SW = 27;
constexpr int PIN_I2C_SCL = 22;
constexpr int PIN_I2C_SDA = 21;
// Deterministic Moki focus-timer firmware. USB power, 3.3 V logic.







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

constexpr uint32_t INITIAL_MINUTES = 25;
uint32_t configuredMinutes = INITIAL_MINUTES;
uint32_t remainingMs = INITIAL_MINUTES * 60000UL;
bool running = false;
uint32_t lastTick = 0, lastFrame = 0, switchChangedAt = 0;
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
  if (now - lastFrame >= 100) {
    lastFrame = now;
    uint32_t seconds = (remainingMs + 999) / 1000;
    char clock[16]; snprintf(clock, sizeof(clock), "%02lu:%02lu", (unsigned long)(seconds / 60), (unsigned long)(seconds % 60));
    screen("FOCUS TIMER", clock, running ? "Press to pause" : remainingMs == 0 ? "Done - press to restart" : "Turn: minutes / Press: go");
    // A serial fallback also works when no OLED responds.
    if (now % 1000 < 100) Serial.println(clock);
  }
  delay(1);
}

int main() {
 setup();
 auto step=[](uint32_t ms) {fakeNow+=ms;loop();};
 auto push=[&](bool down) {fakePins[PIN_ENCODER_SW]=down?LOW:HIGH;step(1);step(31);};
 assert(remainingMs==25*60000UL);
 push(true);assert(running);step(1000);assert(remainingMs==25*60000UL-1000);
 push(false);push(true);assert(!running);uint32_t paused=remainingMs;step(5000);assert(remainingMs==paused);
 // Four quadrature transitions, one detent, changes the configured duration once.
 const int positions[]={1,0,2,3};
 for(int position:positions) {fakePins[PIN_ENCODER_A]=(position>>1)&1;fakePins[PIN_ENCODER_B]=position&1;step(1);}
 assert(configuredMinutes==24 || configuredMinutes==26);
 assert(remainingMs==configuredMinutes*60000UL);
 push(false);push(true);assert(running);
 remainingMs=100;step(100);assert(!running && remainingMs==0 && chiming);
 assert(fakeTone[BUZZER_CHANNEL]>0);step(650);assert(!chiming && fakeTone[BUZZER_CHANNEL]==0);
 assert(fakeScreen=="00:00");
 return 0;
}